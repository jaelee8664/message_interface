package com.synapse.message_interface.repository

import com.synapse.message_interface.domain.Account
import org.springframework.data.mongodb.repository.ReactiveMongoRepository
import reactor.core.publisher.Mono

interface AccountRepository : ReactiveMongoRepository<Account, String> {
    fun findByUsername(username: String): Mono<Account>
}
