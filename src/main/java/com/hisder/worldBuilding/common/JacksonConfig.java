package com.hisder.worldBuilding.common;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * spring-boot-starter-webmvc alone doesn't autoconfigure an ObjectMapper
 * bean the way spring-boot-starter-web/-json used to (Boot's modular
 * starters split that out) -- AiGenerationService needs one injected
 * directly to parse the AI aggregator's response, so it's provided here
 * explicitly.
 */
@Configuration
public class JacksonConfig {

    @Bean
    public ObjectMapper objectMapper() {
        return new ObjectMapper();
    }
}
