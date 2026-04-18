package com.synapse.message_interface.security

import org.springframework.http.HttpHeaders
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.ReactiveSecurityContextHolder
import org.springframework.stereotype.Component
import org.springframework.web.server.ServerWebExchange
import org.springframework.web.server.WebFilter
import org.springframework.web.server.WebFilterChain
import reactor.core.publisher.Mono

@Component
class JwtAuthenticationFilter(private val jwtUtil: JwtUtil) : WebFilter {

    override fun filter(exchange: ServerWebExchange, chain: WebFilterChain): Mono<Void> {
        val header = exchange.request.headers.getFirst(HttpHeaders.AUTHORIZATION)
        if (header == null || !header.startsWith("Bearer ")) {
            return chain.filter(exchange)
        }
        val token = header.removePrefix("Bearer ").trim()
        return try {
            val username = jwtUtil.getUsername(token)
            val role = jwtUtil.getRole(token)
            val auth = UsernamePasswordAuthenticationToken(
                username, null,
                listOf(SimpleGrantedAuthority("ROLE_${role.name}"))
            )
            chain.filter(exchange)
                .contextWrite(ReactiveSecurityContextHolder.withAuthentication(auth))
        } catch (_: Exception) {
            chain.filter(exchange)
        }
    }
}
