package com.synapse.message_interface.domain

import org.springframework.data.annotation.Id
import org.springframework.data.mongodb.core.index.Indexed
import org.springframework.data.mongodb.core.mapping.Document

enum class AccountRole { SUPER_ADMIN, ADMIN, GENERAL }

@Document(collection = "accounts")
data class Account(
    @Id val id: String? = null,
    @Indexed(unique = true) val username: String,
    val passwordHash: String,
    val role: AccountRole
)
