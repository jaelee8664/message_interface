package com.synapse.message_interface.api.dto

import com.synapse.message_interface.domain.AccountRole

data class LoginRequest(val username: String, val password: String)

data class LoginResponse(val token: String, val username: String, val role: AccountRole)

data class CreateAccountRequest(val username: String, val password: String, val role: AccountRole)

data class UpdateAccountRequest(val password: String? = null, val role: AccountRole? = null)

data class RegisterRequest(val username: String, val password: String)

data class AccountDto(val id: String, val username: String, val role: AccountRole)

data class ChangePasswordRequest(val currentPassword: String, val newPassword: String)
