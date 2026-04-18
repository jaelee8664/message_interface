package com.synapse.message_interface.api

import com.synapse.message_interface.api.dto.*
import com.synapse.message_interface.security.JwtUtil
import com.synapse.message_interface.service.AccountService
import org.slf4j.LoggerFactory
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/synapse/auth")
class AuthController(
    private val accountService: AccountService,
    private val jwtUtil: JwtUtil
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @PostMapping("/register")
    suspend fun register(@RequestBody req: RegisterRequest): ResponseEntity<ApiResponse<*>> {
        return try {
            val account = accountService.create(req.username, req.password, com.synapse.message_interface.domain.AccountRole.GENERAL)
            ResponseEntity.ok(ApiResponse.ok(AccountDto(account.id!!, account.username, account.role)))
        } catch (e: IllegalStateException) {
            ResponseEntity.badRequest().body(ApiResponse.error(e.message ?: "회원가입 실패"))
        } catch (e: Exception) {
            log.error("[Auth] register error", e)
            ResponseEntity.status(500).body(ApiResponse.error(e.message ?: "서버 오류"))
        }
    }

    @PostMapping("/login")
    suspend fun login(@RequestBody req: LoginRequest): ResponseEntity<ApiResponse<*>> {
        return try {
            val account = accountService.authenticate(req.username, req.password)
                ?: return ResponseEntity.status(401).body(ApiResponse.error("아이디 또는 비밀번호가 올바르지 않습니다."))
            val token = jwtUtil.generate(account.username, account.role)
            ResponseEntity.ok(ApiResponse.ok(LoginResponse(token, account.username, account.role)))
        } catch (e: Exception) {
            log.error("[Auth] login error", e)
            ResponseEntity.status(500).body(ApiResponse.error(e.message ?: "서버 오류"))
        }
    }

    @GetMapping("/me")
    suspend fun me(auth: Authentication): ResponseEntity<ApiResponse<*>> {
        val account = accountService.findAll().find { it.username == auth.name }
            ?: return ResponseEntity.status(404).body(ApiResponse.error("계정을 찾을 수 없습니다."))
        return ResponseEntity.ok(ApiResponse.ok(AccountDto(account.id!!, account.username, account.role)))
    }

    @GetMapping("/accounts")
    suspend fun listAccounts(): ResponseEntity<ApiResponse<*>> {
        val accounts = accountService.findAll().map { AccountDto(it.id!!, it.username, it.role) }
        return ResponseEntity.ok(ApiResponse.ok(accounts))
    }

    @PostMapping("/accounts")
    suspend fun createAccount(@RequestBody req: CreateAccountRequest): ResponseEntity<ApiResponse<*>> {
        return try {
            val account = accountService.create(req.username, req.password, req.role)
            ResponseEntity.ok(ApiResponse.ok(AccountDto(account.id!!, account.username, account.role)))
        } catch (e: IllegalStateException) {
            ResponseEntity.badRequest().body(ApiResponse.error(e.message ?: "계정 생성 실패"))
        }
    }

    @PutMapping("/accounts/{id}")
    suspend fun updateAccount(
        @PathVariable id: String,
        @RequestBody req: UpdateAccountRequest
    ): ResponseEntity<ApiResponse<*>> {
        return try {
            val account = accountService.update(id, req.password, req.role)
            ResponseEntity.ok(ApiResponse.ok(AccountDto(account.id!!, account.username, account.role)))
        } catch (e: NoSuchElementException) {
            ResponseEntity.status(404).body(ApiResponse.error(e.message ?: "계정을 찾을 수 없습니다."))
        } catch (e: IllegalStateException) {
            ResponseEntity.badRequest().body(ApiResponse.error(e.message ?: "계정 수정 실패"))
        }
    }

    @PostMapping("/change-password")
    suspend fun changePassword(
        auth: Authentication,
        @RequestBody req: ChangePasswordRequest
    ): ResponseEntity<ApiResponse<*>> {
        return try {
            accountService.changePassword(auth.name, req.currentPassword, req.newPassword)
            ResponseEntity.ok(ApiResponse.ok("비밀번호가 변경되었습니다."))
        } catch (e: IllegalArgumentException) {
            ResponseEntity.badRequest().body(ApiResponse.error(e.message ?: "비밀번호 변경 실패"))
        } catch (e: NoSuchElementException) {
            ResponseEntity.status(404).body(ApiResponse.error(e.message ?: "계정을 찾을 수 없습니다."))
        } catch (e: Exception) {
            log.error("[Auth] changePassword error", e)
            ResponseEntity.status(500).body(ApiResponse.error(e.message ?: "서버 오류"))
        }
    }

    @DeleteMapping("/accounts/{id}")
    suspend fun deleteAccount(@PathVariable id: String): ResponseEntity<ApiResponse<*>> {
        return try {
            accountService.delete(id)
            ResponseEntity.ok(ApiResponse.ok("삭제 완료"))
        } catch (e: NoSuchElementException) {
            ResponseEntity.status(404).body(ApiResponse.error(e.message ?: "계정을 찾을 수 없습니다."))
        } catch (e: IllegalStateException) {
            ResponseEntity.badRequest().body(ApiResponse.error(e.message ?: "계정 삭제 실패"))
        }
    }
}
