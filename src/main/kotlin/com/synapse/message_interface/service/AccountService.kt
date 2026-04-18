package com.synapse.message_interface.service

import com.synapse.message_interface.domain.Account
import com.synapse.message_interface.domain.AccountRole
import com.synapse.message_interface.repository.AccountRepository
import jakarta.annotation.PostConstruct
import kotlinx.coroutines.reactive.awaitFirstOrNull
import kotlinx.coroutines.runBlocking
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.stereotype.Service

@Service
class AccountService(
    private val repo: AccountRepository,
    @Value("\${super.admin.username:admin}") private val defaultUsername: String,
    @Value("\${super.admin.password:admin}") private val defaultPassword: String
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val encoder = BCryptPasswordEncoder()

    @PostConstruct
    fun initDefaultSuperAdmin() {
        runBlocking {
            val count = repo.count().awaitFirstOrNull() ?: 0L
            if (count == 0L) {
                val account = Account(
                    username = defaultUsername,
                    passwordHash = encoder.encode(defaultPassword) as String,
                    role = AccountRole.SUPER_ADMIN
                )
                repo.save(account).awaitFirstOrNull()
                log.info("[AccountService] 기본 슈퍼어드민 계정 생성: $defaultUsername")
            }
        }
    }

    suspend fun authenticate(username: String, password: String): Account? {
        val account = repo.findByUsername(username).awaitFirstOrNull() ?: return null
        return if (encoder.matches(password, account.passwordHash)) account else null
    }

    suspend fun findAll(): List<Account> =
        repo.findAll().collectList().awaitFirstOrNull() ?: emptyList()

    suspend fun findById(id: String): Account? =
        repo.findById(id).awaitFirstOrNull()

    suspend fun create(username: String, password: String, role: AccountRole): Account {
        val existing = repo.findByUsername(username).awaitFirstOrNull()
        if (existing != null) throw IllegalStateException("이미 사용 중인 아이디입니다.")
        if (role == AccountRole.SUPER_ADMIN) {
            val superAdmins = repo.findAll()
                .filter { it.role == AccountRole.SUPER_ADMIN }
                .collectList().awaitFirstOrNull()
            if (!superAdmins.isNullOrEmpty()) {
                throw IllegalStateException("슈퍼어드민은 하나만 존재할 수 있습니다.")
            }
        }
        val account = Account(
            username = username,
            passwordHash = encoder.encode(password) as String,
            role = role
        )
        return repo.save(account).awaitFirstOrNull()
            ?: throw IllegalStateException("계정 저장 실패")
    }

    suspend fun update(id: String, password: String?, role: AccountRole?): Account {
        val existing = repo.findById(id).awaitFirstOrNull()
            ?: throw NoSuchElementException("계정을 찾을 수 없습니다: $id")

        if (role == AccountRole.SUPER_ADMIN && existing.role != AccountRole.SUPER_ADMIN) {
            val existingSuperAdmins = repo.findAll()
                .filter { it.role == AccountRole.SUPER_ADMIN }
                .collectList().awaitFirstOrNull()
            if (!existingSuperAdmins.isNullOrEmpty()) {
                throw IllegalStateException("슈퍼어드민은 하나만 존재할 수 있습니다.")
            }
        }

        val updated = existing.copy(
            passwordHash = if (password != null) encoder.encode(password) as String else existing.passwordHash,
            role = role ?: existing.role
        )
        return repo.save(updated).awaitFirstOrNull()
            ?: throw IllegalStateException("계정 저장 실패")
    }

    suspend fun changePassword(username: String, currentPassword: String, newPassword: String) {
        val account = repo.findByUsername(username).awaitFirstOrNull()
            ?: throw NoSuchElementException("계정을 찾을 수 없습니다.")
        if (!encoder.matches(currentPassword, account.passwordHash)) {
            throw IllegalArgumentException("현재 비밀번호가 올바르지 않습니다.")
        }
        val updated = account.copy(passwordHash = encoder.encode(newPassword) as String)
        repo.save(updated).awaitFirstOrNull()
    }

    suspend fun delete(id: String) {
        val account = repo.findById(id).awaitFirstOrNull()
            ?: throw NoSuchElementException("계정을 찾을 수 없습니다: $id")
        if (account.role == AccountRole.SUPER_ADMIN) {
            throw IllegalStateException("슈퍼어드민 계정은 삭제할 수 없습니다.")
        }
        repo.deleteById(id).awaitFirstOrNull()
    }
}
