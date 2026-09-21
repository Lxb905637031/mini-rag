/**
 * @file apps/api/src/ingestion/ingestion.queue.ts
 * @description 文档索引任务队列（生产者端）：把“某个文档需要建索引”这件事持久化到 Redis。
 *
 * 为什么要用 BullMQ 队列（对比改造前的做法）：
 *   改造前：upload() 里 `void this.process(...)` 直接在进程内跑后台任务，是“发射后不管”。
 *   这样有三个闭环缺陷：
 *     1) API 进程重启/崩溃时，正在处理与排队中的任务凭空丢失，文档永久卡在 PENDING/PROCESSING；
 *     2) Ollama 瞬时抖动一次就直接 ERROR，没有自动重试；
 *     3) 同时上传多个大 PDF 时多个解析任务并发打 Ollama，容易拖垮 embedding 服务。
 *   改造后：任务先写进 Redis（BullMQ 队列），再由 IngestionWorker 消费执行——
 *     任务持久化（重启不丢）、失败自动重试（指数退避）、串行消费（保护 Ollama）。
 *
 * 小白概念（BullMQ 三要素）：
 *   - Queue（队列）：生产者，负责“往 Redis 里添加任务”。本文件就是它。
 *   - Worker（工人）：消费者，负责“取出任务并执行”。见 ingestion.worker.ts。
 *   - Job（任务）：队列里的一条待办，这里 payload 只放 documentId——
 *     文件二进制始终留在 SQLite 的 Document.content，process() 会自己去查，
 *     队列只当“记事本”，不搬运大对象。
 *
 * 连接说明：
 *   BullMQ 需要“连接配置对象”而不是现成的 ioredis 实例（它会自己创建并管理连接），
 *   所以这里不把 RedisService 里的单例传给它，而是用 buildBullConnection() 解析
 *   REDIS_URL 生成纯配置。项目里会同时存在两条 Redis 连接：
 *     - RedisService 的：负责 JWT 黑名单等业务读写；
 *     - BullMQ 的：专门服务队列（Queue + Worker 各一条）。
 *   两者互不干扰，都是连 docker-compose 里的同一个 redis:7 容器。
 */
// Queue：BullMQ 的队列类（生产者）；Job：单条任务对象；ConnectionOptions：连接配置类型。
import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq'
// Injectable：让 Nest 容器把这个类注册为可注入的单例服务。
// OnModuleDestroy：实现它后，应用关闭时 Nest 会自动调用 onModuleDestroy 方法。
import { Injectable, type OnModuleDestroy } from '@nestjs/common'

/**
 * 队列名：BullMQ 会用它生成一组 Redis 键（列表/集合等），如 mini-rag:ingestion:wait。
 * Queue 和 Worker 必须用同一个名字 + 同一个 prefix，才能“你加我取”对上话。
 */
export const INGESTION_QUEUE_NAME = 'ingestion'

/**
 * 所有队列 Redis 键的统一前缀：最终 key 形如 mini-rag:ingestion:wait。
 * 加前缀是为了在 redis-cli 里 keys 'mini-rag:*' 一眼分清本项目数据，
 * 命名风格对齐 RedisService 中 REDIS_KEYS 的“业务:用途”习惯。
 */
export const BULL_KEY_PREFIX = 'mini-rag'

/**
 * 任务数据（payload）类型：一个任务只携带“要处理哪个文档”这一个信息。
 * 刻意不放文件内容：二进制留在 SQLite（Document.content BLOB），
 * Worker 执行时由 IngestionService.process() 自己查询——单一数据源，不会不一致。
 */
export type IngestionJobData = {
  /** 待索引的文档 id（Document 表主键） */
  documentId: string
}

/**
 * 统一构造任务的 jobId（任务唯一标识）：规则为 "index-<文档id>"。
 * jobId 的妙用——幂等去重：只要 Redis 里还存在同 id 任务（排队中/处理中/延迟重试中），
 * 再次 add 同 jobId 的任务会被 BullMQ 静默忽略。
 * 于是“上传时入队”和“启动自愈重新入队”两个入口可以放心地重复添加，不会重复消费。
 * @param documentId 文档 id
 */
export const ingestionJobId = (documentId: string) => `index-${documentId}`

/**
 * 把 REDIS_URL 环境变量解析成 BullMQ 要的连接配置对象。
 *
 * 为什么不用 RedisService 的现成连接：
 *   BullMQ 的 Queue/Worker 会自己 new ioredis 连接并做订阅、续锁等队列专属操作，
 *   传入外部实例反而会导致它复用出问题；官方推荐只给配置，让它自己管连接。
 *
 * @returns 连接配置（host/port/可选的密码等）
 */
export function buildBullConnection(): ConnectionOptions {
  // new URL() 可以把 "redis://:password@127.0.0.1:6379" 这类地址拆成各部分；
  // 未配置 REDIS_URL 时回退到本机默认端口（与 RedisService 的默认值保持一致）。
  const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379')
  return {
    // hostname/port：Redis 服务器地址，来自 URL 的主机与端口部分。
    host: url.hostname,
    port: Number(url.port || 6379),
    // username/password：本地开发通常为空，生产环境可能需要（从 URL 里取）。
    username: url.username || undefined,
    password: url.password || undefined,
    // maxRetriesPerRequest: null 是 BullMQ 的硬性要求（尤其是 Worker 端）：
    // 队列命令（取任务、续锁等）必须在断线时无限等待重连，而不是重试几次就报错放弃，
    // 否则任务可能“卡死在半路”。设为 null 表示“单条命令不做内部重试上限”。
    maxRetriesPerRequest: null,
  }
}

/**
 * 队列默认任务选项：add() 时不传 options 也会套用这里的重试/清理策略。
 * 集中放在队列配置里，保证“上传入队”和“自愈入队”两条路径的行为完全一致。
 */
export const ingestionJobOptions: JobsOptions = {
  // attempts：一个任务最多执行 3 次（首次 + 2 次自动重试）。
  attempts: 3,
  // backoff：重试间隔用指数退避——第 1 次失败后等 3s 再试，第 2 次失败后等 6s 再试。
  // 指数退避能给“暂时性故障”（如 Ollama 加载模型慢、网络抖动）留出恢复时间。
  backoff: { type: 'exponential', delay: 3000 },
  // removeOnComplete：成功完成的任务保留 10 分钟且最多 500 条，方便排查后自动清理。
  removeOnComplete: { age: 600, count: 500 },
  // removeOnFail：最终失败（重试耗尽）的任务保留 24 小时，便于事后在 Redis 里查原因。
  removeOnFail: { age: 24 * 60 * 60 },
}

/**
 * 文档索引队列（生产者）。
 *
 * 为什么继承 Queue 类而不是用工厂函数提供裸实例：
 *   Nest 的生命周期钩子（onModuleDestroy）只会挂在“被容器管理的类实例”上。
 *   继承后 IngestionQueue 本身就是 @Injectable 服务，应用关闭时能自动拿到
 *   onModuleDestroy 回调，优雅断开 Redis 连接；工厂函数产出的裸 Queue 做不到。
 */
@Injectable()
export class IngestionQueue extends Queue<IngestionJobData> implements OnModuleDestroy {
  constructor() {
    // 调用父类 Queue 的构造函数：参数 1 队列名；参数 2 队列配置。
    super(INGESTION_QUEUE_NAME, {
      // prefix：本队列所有 Redis 键的公共前缀（Worker 端必须配置同一个值）。
      prefix: BULL_KEY_PREFIX,
      // connection：BullMQ 自行创建的 Redis 连接配置（见 buildBullConnection 说明）。
      connection: buildBullConnection(),
      // defaultJobOptions：add() 时的默认策略（重试次数、退避、完成/失败后的保留规则）。
      defaultJobOptions: ingestionJobOptions,
    })
    // Queue 继承自 EventEmitter（事件发射器）。如果不挂 'error' 监听，
    // 一旦连接出错 Node 会按“未处理的 error 事件”直接把整个进程崩溃掉。
    // 这里只打日志不抛出：Redis 断连时 ioredis 会按配置自动重连。
    this.on('error', error => {
      console.error(`[ingestion-queue] 队列连接/操作异常：${error.message}`)
    })
  }

  /**
   * 应用关闭时优雅断开队列的生产者连接。
   * close() 会等待队列不再有进行中的内部操作后断连；失败也只吞掉，
   * 不能让“关闭时的小问题”阻止进程退出。
   */
  async onModuleDestroy(): Promise<void> {
    await this.close().catch(() => undefined)
  }
}
