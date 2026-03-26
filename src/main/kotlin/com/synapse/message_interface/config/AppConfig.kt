package com.synapse.message_interface.config

import tools.jackson.databind.ObjectMapper
import tools.jackson.databind.DeserializationFeature
import tools.jackson.databind.json.JsonMapper
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.scheduling.annotation.EnableScheduling
import org.springframework.web.reactive.function.client.WebClient

@Configuration
@EnableScheduling
class AppConfig {
    @Bean
    fun objectMapper(): ObjectMapper = JsonMapper.builder()
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build()

    @Bean
    fun webClient(): WebClient = WebClient.builder().build()
}
