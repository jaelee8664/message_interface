package com.synapse.message_interface.security

import com.synapse.message_interface.domain.AccountRole
import io.jsonwebtoken.Claims
import io.jsonwebtoken.Jwts
import io.jsonwebtoken.security.Keys
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.util.Date
import javax.crypto.SecretKey

@Component
class JwtUtil(
    @Value("\${jwt.secret:synapse-message-interface-secret-key-must-be-at-least-32-chars}") secret: String,
    @Value("\${jwt.expiration-hours:8}") private val expirationHours: Long
) {
    private val key: SecretKey = Keys.hmacShaKeyFor(secret.toByteArray())

    fun generate(username: String, role: AccountRole): String =
        Jwts.builder()
            .subject(username)
            .claim("role", role.name)
            .issuedAt(Date())
            .expiration(Date(System.currentTimeMillis() + expirationHours * 3600_000))
            .signWith(key)
            .compact()

    fun parse(token: String): Claims =
        Jwts.parser().verifyWith(key).build().parseSignedClaims(token).payload

    fun getUsername(token: String): String = parse(token).subject
    fun getRole(token: String): AccountRole = AccountRole.valueOf(parse(token)["role"] as String)
}
