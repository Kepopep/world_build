package com.hisder.worldBuilding.ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hisder.worldBuilding.ai.contract.AiModelResponse;
import com.hisder.worldBuilding.entry.Entry;
import com.hisder.worldBuilding.entry.EntryService;
import com.hisder.worldBuilding.entry.contract.EntryUpdateRequest;
import com.hisder.worldBuilding.tag.Tag;
import com.hisder.worldBuilding.tag.TagService;
import com.hisder.worldBuilding.world.World;
import com.hisder.worldBuilding.world.WorldService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

/**
 * Generates a draft Entry from a natural-language prompt via any
 * OpenAI-compatible chat/completions aggregator (OpenRouter or similar) --
 * base URL + API key are configurable, never a specific provider SDK. No own
 * JPA entity; composes WorldService/EntryService/TagService, the same
 * "thin service over existing repos" shape GraphService and SearchController
 * already use for read/compute-only features. Deliberately depends on
 * sibling services rather than repositories directly (a departure from how
 * EntryService/TagService/GraphService are wired) because the point here is
 * to reuse their existing creation/attachment logic, not reimplement it.
 */
@Service
public class AiGenerationService {

    // Keeps the system prompt bounded for large worlds -- most-recently-
    // updated entries are the most likely to matter for staying consistent
    // with a prompt about "what's going on in this world right now".
    private static final int MAX_CONTEXT_ENTRIES = 30;

    private final WorldService worldService;
    private final EntryService entryService;
    private final TagService tagService;
    private final ObjectMapper objectMapper;

    @Value("${ai.aggregator.base-url}")
    private String aggregatorBaseUrl;

    @Value("${ai.aggregator.api-key}")
    private String aggregatorApiKey;

    @Value("${ai.aggregator.models}")
    private String aggregatorModelsCsv;

    public AiGenerationService(WorldService worldService, EntryService entryService, TagService tagService,
                                ObjectMapper objectMapper) {
        this.worldService = worldService;
        this.entryService = entryService;
        this.tagService = tagService;
        this.objectMapper = objectMapper;
    }

    public Entry generateEntry(Long worldId, String prompt, String model, Long folderId) {
        if (prompt == null || prompt.isBlank()) {
            throw new IllegalArgumentException("Prompt must not be blank");
        }
        // Enforced here too, not just in listModels()'s picker -- otherwise
        // a client could bypass the OpenAI-only restriction by posting an
        // arbitrary model id straight to this endpoint instead of picking
        // one from the (already-filtered) list.
        if (model != null && !model.isBlank() && !isOpenAiModelId(model)) {
            throw new IllegalArgumentException("Only OpenAI models are permitted");
        }
        if (aggregatorBaseUrl == null || aggregatorBaseUrl.isBlank()) {
            throw new AiGenerationException("AI aggregator is not configured (AI_AGGREGATOR_BASE_URL not set)");
        }
        World world = worldService.getWorld(worldId);
        List<Entry> contextEntries = entryService.listEntries(worldId).stream()
                .sorted(Comparator.comparing(Entry::getUpdatedAt).reversed())
                .limit(MAX_CONTEXT_ENTRIES)
                .toList();
        List<Tag> worldTags = tagService.listTags(worldId);

        GeneratedEntryPayload payload = callAggregator(buildSystemPrompt(world, contextEntries, worldTags), prompt, model);

        Entry entry = entryService.createEntry(worldId, payload.title(),
                payload.contentMarkdown() == null ? "" : payload.contentMarkdown(), folderId);
        if (payload.summary() != null && !payload.summary().isBlank()) {
            entryService.updateEntry(entry.getId(), new EntryUpdateRequest(null, payload.summary(), null, null));
        }
        if (payload.suggestedTags() != null) {
            for (String tagName : payload.suggestedTags()) {
                if (tagName != null && !tagName.isBlank()) {
                    tagService.addTagToEntry(entry.getId(), tagName, null);
                }
            }
        }
        // Re-fetch rather than trust the intermediate entity handed back by
        // the last addTagToEntry call -- each of the calls above commits in
        // its own transaction, so this is the one canonical, fully-hydrated
        // read of the final state.
        return entryService.getEntry(entry.getId());
    }

    public List<AiModelResponse> listModels() {
        List<AiModelResponse> models = List.of();
        if (aggregatorBaseUrl != null && !aggregatorBaseUrl.isBlank()) {
            try {
                JsonNode response = client().get()
                        .uri("/models")
                        .retrieve()
                        .body(JsonNode.class);
                models = parseModelList(response);
            } catch (RuntimeException ignored) {
                // Aggregator has no /models endpoint, or it's unreachable --
                // fall through to the configured static fallback below
                // rather than failing the whole model picker.
            }
        }
        if (models.isEmpty()) {
            models = fallbackModels();
        }
        return models.stream()
                .sorted(Comparator.comparing(AiModelResponse::name, String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    private List<AiModelResponse> parseModelList(JsonNode response) {
        List<AiModelResponse> models = new ArrayList<>();
        if (response == null || !response.path("data").isArray()) {
            return models;
        }
        for (JsonNode item : response.path("data")) {
            String id = item.path("id").asText(null);
            if (id == null || id.isBlank()) {
                continue;
            }
            if (!supportsTextApi(item) || !isOpenAiModel(item, id)) {
                continue;
            }
            models.add(new AiModelResponse(id, item.path("name").asText(id)));
        }
        return models;
    }

    // Restricted to OpenAI models only -- excluded before the list ever
    // reaches listModels()'s caller (the /api/ai/models response), so a
    // non-OpenAI model can never appear in the frontend picker in the first
    // place. An aggregator's /models list (e.g. OpenRouter) mixes many
    // vendors under "<vendor>/<model>" ids -- trust that prefix when
    // present. A bare id (no "/") could come from an aggregator that
    // proxies OpenAI directly (e.g. hitting OpenAI's own API, whose
    // /v1/models response carries no vendor prefix but does set
    // "owned_by":"openai" per item) -- check that field for those. Fails
    // CLOSED or either check is inconclusive: an unverifiable model is
    // excluded rather than risking a non-OpenAI model slipping through.
    private boolean isOpenAiModel(JsonNode item, String id) {
        int slash = id.indexOf('/');
        if (slash >= 0) {
            return id.substring(0, slash).equalsIgnoreCase("openai");
        }
        String ownedBy = item.path("owned_by").asText(null);
        return ownedBy != null && ownedBy.equalsIgnoreCase("openai");
    }

    // String-only variant for call sites with no aggregator JSON to inspect
    // (the static CSV fallback, and the raw "model" id posted straight to
    // generateEntry) -- an operator-configured fallback id must be
    // explicitly vendor-prefixed ("openai/gpt-4o") to be recognized, since
    // there's no "owned_by" metadata to fall back on here.
    private boolean isOpenAiModelId(String id) {
        if (id == null) {
            return false;
        }
        int slash = id.indexOf('/');
        return slash >= 0 && id.substring(0, slash).equalsIgnoreCase("openai");
    }

    // OpenRouter-shaped /models entries carry an "architecture" object
    // describing supported modalities -- this feature only ever calls
    // /chat/completions with plain text messages, so image/audio-only or
    // non-text-output models are useless here and get filtered out. Fails
    // open (keeps the model) when "architecture" or a given modality array
    // is missing entirely, since some OpenAI-compatible aggregators don't
    // report it at all -- better to over-include than to hide every model
    // for an aggregator that just doesn't send this field.
    private boolean supportsTextApi(JsonNode item) {
        JsonNode architecture = item.path("architecture");
        if (architecture.isMissingNode() || architecture.isNull()) {
            return true;
        }
        return containsText(architecture.path("input_modalities"))
                && containsText(architecture.path("output_modalities"));
    }

    private boolean containsText(JsonNode modalities) {
        if (!modalities.isArray()) {
            return true;
        }
        for (JsonNode modality : modalities) {
            if ("text".equalsIgnoreCase(modality.asText())) {
                return true;
            }
        }
        return false;
    }

    private List<AiModelResponse> fallbackModels() {
        if (aggregatorModelsCsv == null || aggregatorModelsCsv.isBlank()) {
            return List.of();
        }
        return parseModelIds(aggregatorModelsCsv).stream()
                .filter(this::isOpenAiModelId)
                .map(id -> new AiModelResponse(id, id))
                .toList();
    }

    // Accepts either a JSON array literal (e.g. ["a","b"]) or a plain CSV
    // string (e.g. "a,b") for ai.aggregator.models -- both are reasonable
    // ways to hand-set an env var, and split(",") alone mangles the former.
    private List<String> parseModelIds(String raw) {
        String trimmed = raw.trim();
        if (trimmed.startsWith("[")) {
            try {
                List<String> parsed = objectMapper.readValue(trimmed, new TypeReference<List<String>>() {
                });
                return parsed.stream()
                        .filter(id -> id != null)
                        .map(String::trim)
                        .filter(id -> !id.isBlank())
                        .toList();
            } catch (JsonProcessingException ignored) {
                // Not valid JSON -- fall through to CSV parsing below.
            }
        }
        return Arrays.stream(trimmed.split(","))
                .map(String::trim)
                .filter(id -> !id.isBlank())
                .toList();
    }

    private GeneratedEntryPayload callAggregator(String systemPrompt, String userPrompt, String model) {
        ChatCompletionRequest request = new ChatCompletionRequest(
                model,
                List.of(new ChatMessage("system", systemPrompt), new ChatMessage("user", userPrompt)),
                new ResponseFormat("json_object")
        );
        JsonNode response;
        try {
            response = client().post()
                    .uri("/chat/completions")
                    .body(request)
                    .retrieve()
                    .body(JsonNode.class);
        } catch (RuntimeException e) {
            throw new AiGenerationException("Failed to reach AI aggregator: " + e.getMessage());
        }
        String content = response == null ? null
                : response.path("choices").path(0).path("message").path("content").asText(null);
        if (content == null || content.isBlank()) {
            throw new AiGenerationException("Aggregator response missing expected content");
        }
        GeneratedEntryPayload payload;
        try {
            payload = objectMapper.readValue(content, GeneratedEntryPayload.class);
        } catch (JsonProcessingException e) {
            throw new AiGenerationException("AI returned malformed entry data: " + e.getMessage());
        }
        if (payload.title() == null || payload.title().isBlank()) {
            throw new AiGenerationException("AI returned malformed entry data: missing title");
        }
        return payload;
    }

    // Built fresh off the static factory rather than an injected
    // RestClient.Builder bean -- spring-boot-starter-webmvc alone doesn't
    // autoconfigure one (that's WebClient/RestTemplate territory split
    // differently in Boot's modular starters), and RestClient.builder()
    // needs no autoconfiguration at all.
    //
    // Explicit Jackson 2 converter: this project's classpath carries both
    // Jackson 3 (Spring Boot 4's new default, via spring-boot-starter-web)
    // and Jackson 2 (pulled in transitively by springdoc, which hasn't
    // migrated yet). RestClient.builder() auto-detects both and registers
    // the Jackson 3 converter first, which can't handle the Jackson 2
    // JsonNode type this class deserializes into -- pin Jackson 2 ahead of
    // it so JsonNode responses actually work.
    private RestClient client() {
        return RestClient.builder()
                .baseUrl(aggregatorBaseUrl)
                .defaultHeader("Authorization", "Bearer " + aggregatorApiKey)
                .messageConverters(converters -> converters.add(0, new MappingJackson2HttpMessageConverter(objectMapper)))
                .build();
    }

    private String buildSystemPrompt(World world, List<Entry> contextEntries, List<Tag> worldTags) {
        StringBuilder sb = new StringBuilder();
        sb.append("You are a worldbuilding assistant writing a new wiki entry for the world \"")
                .append(world.getName())
                .append("\". Stay consistent with the existing lore listed below; do not contradict it.\n\n");

        if (!contextEntries.isEmpty()) {
            sb.append("Existing entries in this world:\n");
            for (Entry entry : contextEntries) {
                sb.append("- ").append(entry.getTitle());
                if (entry.getSummary() != null && !entry.getSummary().isBlank()) {
                    sb.append(": ").append(entry.getSummary());
                }
                sb.append("\n");
            }
            sb.append("\n");
        }

        if (!worldTags.isEmpty()) {
            sb.append("Existing tags in this world: ")
                    .append(worldTags.stream().map(Tag::getName).reduce((a, b) -> a + ", " + b).orElse(""))
                    .append("\n\n");
        }

        sb.append("Respond with ONLY a single JSON object, no markdown code fence and no prose outside it, ")
                .append("matching exactly this shape: {\"title\": string (short, no markdown), ")
                .append("\"summary\": string (one plain-text sentence), ")
                .append("\"contentMarkdown\": string (the full entry body, written in markdown), ")
                .append("\"suggestedTags\": array of 0-5 short strings, reusing an existing tag name above where it fits}.");
        return sb.toString();
    }

    private record ChatMessage(String role, String content) {
    }

    private record ResponseFormat(String type) {
    }

    private record ChatCompletionRequest(
            String model,
            List<ChatMessage> messages,
            @JsonProperty("response_format") ResponseFormat responseFormat
    ) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record GeneratedEntryPayload(String title, String summary, String contentMarkdown, List<String> suggestedTags) {
    }
}
