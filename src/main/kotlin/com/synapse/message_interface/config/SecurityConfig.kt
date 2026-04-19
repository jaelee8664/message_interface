package com.synapse.message_interface.config

import com.synapse.message_interface.security.JwtAuthenticationFilter
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpMethod
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity
import org.springframework.security.config.web.server.SecurityWebFiltersOrder
import org.springframework.security.config.web.server.ServerHttpSecurity
import org.springframework.security.web.server.SecurityWebFilterChain

@Configuration
@EnableWebFluxSecurity
class SecurityConfig(private val jwtFilter: JwtAuthenticationFilter) {

    @Bean
    fun securityFilterChain(http: ServerHttpSecurity): SecurityWebFilterChain =
        http
            .csrf { it.disable() }
            .httpBasic { it.disable() }
            .formLogin { it.disable() }
            .addFilterAt(jwtFilter, SecurityWebFiltersOrder.AUTHENTICATION)
            .authorizeExchange { exchanges ->
                exchanges
                    // 로그인/회원가입 공개
                    .pathMatchers(HttpMethod.POST, "/synapse/auth/login").permitAll()
                    .pathMatchers(HttpMethod.POST, "/synapse/auth/register").permitAll()
                    // 계정 관리: 슈퍼어드민 전용
                    .pathMatchers("/synapse/auth/accounts/**").hasRole("SUPER_ADMIN")
                    .pathMatchers(HttpMethod.POST, "/synapse/auth/accounts").hasRole("SUPER_ADMIN")
                    // 내 정보 조회: 인증된 모든 역할
                    .pathMatchers(HttpMethod.GET, "/synapse/auth/me").authenticated()
                    // 쓰기 작업: 어드민 이상
                    .pathMatchers(HttpMethod.POST, "/synapse/workflow/units").hasAnyRole("SUPER_ADMIN", "ADMIN")
                    .pathMatchers(HttpMethod.DELETE, "/synapse/workflow/units").hasAnyRole("SUPER_ADMIN", "ADMIN")
                    .pathMatchers(HttpMethod.POST, "/synapse/workflow/rollback").hasAnyRole("SUPER_ADMIN", "ADMIN")
                    .pathMatchers(HttpMethod.PUT, "/synapse/reference").hasAnyRole("SUPER_ADMIN", "ADMIN")
                    .pathMatchers(HttpMethod.POST, "/synapse/dead-letters/replay").hasAnyRole("SUPER_ADMIN", "ADMIN")
                    .pathMatchers(HttpMethod.POST, "/synapse/simulator/execute").hasAnyRole("SUPER_ADMIN", "ADMIN")
                    .pathMatchers(HttpMethod.POST, "/synapse/simulator/enqueue-and-consume").hasAnyRole("SUPER_ADMIN", "ADMIN")
                    .pathMatchers(HttpMethod.POST, "/synapse/simulator/scenarios").hasAnyRole("SUPER_ADMIN", "ADMIN")
                    .pathMatchers(HttpMethod.DELETE, "/synapse/simulator/scenarios/**").hasAnyRole("SUPER_ADMIN", "ADMIN")
                    .pathMatchers(HttpMethod.POST, "/synapse/simulator/scenarios/**").hasAnyRole("SUPER_ADMIN", "ADMIN")
                    .pathMatchers(HttpMethod.POST, "/synapse/simulator/log-play/**").hasAnyRole("SUPER_ADMIN", "ADMIN")
                    // 나머지 /synapse/ 경로: 인증된 모든 역할 (읽기)
                    .pathMatchers("/synapse/**").authenticated()
                    // 정적 리소스 공개
                    .anyExchange().permitAll()
            }
            .build()
}
