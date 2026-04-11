package com.synapse.message_interface.simulator

import org.springframework.data.mongodb.repository.ReactiveMongoRepository

interface MongoSimulationScenarioRepository : ReactiveMongoRepository<SimulationScenario, String>

/** 유닛별 단일 테스트 메세지 저장소. unitId = _id이므로 자연스럽게 유닛당 1개 유지. */
interface MongoSimulatorUnitMessageRepository : ReactiveMongoRepository<SimulatorUnitMessage, String>
