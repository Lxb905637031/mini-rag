/**
 * app.module.ts —— 应用根模块（模块装配中心）
 *
 * 文件作用：
 *   用 @Module 装饰器声明整个应用由哪些“模块、控制器、服务”组成，
 *   是 NestFactory.create 启动时读取的总装配清单。
 *
 * 在 NestJS 请求生命周期中的位置：模块装配阶段。
 *   应用启动时，Nest 容器先解析本模块的元数据，再实例化其中注册的控制器和
 *   服务，并按构造函数声明自动完成依赖注入；运行期请求则分发到对应控制器。
 *
 * 上下游关系：
 *   上游：main.ts 把本类传给 NestFactory.create 作为根模块。
 *   下游：PrismaModule（数据库连接能力）以及 knowledge/ingestion/chat/
 *         health/lab 各业务目录下的控制器与服务。
 *
 * 小白概念：
 *   - 控制器（Controller）：负责接收 HTTP 请求、返回响应，类上带 @Controller。
 *   - 服务（Provider/Service）：封装可复用的业务逻辑，类上带 @Injectable，
 *     自己不 new 依赖，而是由 Nest 容器在构造函数中注入。
 *   - 模块（Module）：把控制器和服务分组管理；imports 引入其它模块导出的能力，
 *     providers 声明本模块内可注入的服务，controllers 声明本模块的路由入口。
 */
import { Module } from '@nestjs/common'
import { PrismaModule } from './prisma/prisma.module.js'
import { RedisModule } from './redis/redis.module.js'
import { AuthModule } from './auth/auth.module.js'
import { KnowledgeController } from './knowledge/knowledge.controller.js'
import { KnowledgeService } from './knowledge/knowledge.service.js'
import { IngestionController } from './ingestion/ingestion.controller.js'
import { IngestionService } from './ingestion/ingestion.service.js'
import { ChatController } from './chat/chat.controller.js'
import { ChatService } from './chat/chat.service.js'
import { HealthController } from './health/health.controller.js'
import { LabController } from './lab/lab.controller.js'

/**
 * 根模块类：类体为空，所有装配信息都写在 @Module 装饰器的配置对象里。
 */
@Module({
  // imports：引入其它模块。
  // PrismaModule（SQLite）与 RedisModule（Redis）是全局基础模块；
  // AuthModule 提供登录/登出/资料接口，并内置全局 JWT 守卫保护其它所有接口。
  imports: [PrismaModule, RedisModule, AuthModule],
  // controllers：注册所有处理 HTTP 请求的控制器，Nest 据此建立路由表。
  controllers: [
    KnowledgeController, // 知识库管理相关接口
    IngestionController, // 文档摄入（上传、解析、入库）相关接口
    ChatController, // 对话问答（RAG 检索增强生成）相关接口
    HealthController, // 健康检查接口 GET /health（控制器上用 @Public 放行）
    LabController, // 实验/调试用接口
  ],
  // providers：声明可被依赖注入的服务类，供上面的控制器在构造函数中注入使用。
  providers: [KnowledgeService, IngestionService, ChatService],
})
export class AppModule {}
