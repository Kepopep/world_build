package com.hisder.worldBuilding.ai;

/**
 * Thrown for anything that goes wrong talking to the AI aggregator or
 * making sense of what it returned -- unreachable/non-2xx aggregator,
 * missing expected response fields, or a response body that doesn't parse
 * into the JSON shape the system prompt asked for. Mapped to 502 Bad
 * Gateway by GlobalExceptionHandler.
 */
public class AiGenerationException extends RuntimeException {

    public AiGenerationException(String message) {
        super(message);
    }
}
