/**
 * @file apps/api/src/ingestion/ingestion.worker.ts
 * @description 文档索引任务消费者（Worker 端）+ 启动自愈 + 失败状态收尾。
 *
 * 在整条链路中的位置：
 *   upload()/自愈 入队任务 → Redis（BullMQ 队列）→ 本 Worker 取出任务
 *   → 调用 IngestionService.process(documentId) 执行真正的“解析→切块→向量化”流水线
 *
 * 本文件承担三件事：
 *   1) 创建并持有 BullMQ Worker（与 API 同进程运行，无需另开终端）；
 *   2) 失败状态收尾：任务失败时区分“还会重试”与“重试耗尽”，把文档状态
 *      置回 PENDING（等待重试）或 ERROR（终局失败）——这是全项目唯一写 ERROR 的地方；
 *   3) 启动自愈：应用启动时把数据库里卡在 PENDING/PROCESSING 的历史文档重新入队，
 *      兜底“API 崩溃/非优雅退出导致任务丢失”的场景，保证闭环。
 *
 * 小白概念：
 *   - onModuleInit：Nest 生命周期钩子，模块依赖装配完成后自动调用——Worker 在这里启动。
 *   - onModuleDestroy：应用收到退出信号（Ctrl+C）时自动调用——Worker 在这里优雅关闭。
 *   - 优雅停机的意义：worker.close() 会“停止领取新任务、等当前任务跑完再退”，
 *     避免任务做到一半进程消失（那样只能靠 stalled 机制回捞，要多等约 30 秒）。
 */
// Worker：BullMQ 的消费者类；Job：队列里的一条任务对象（事件回调里能拿到）。
import { Job, Worker } from 'bullmq'
// Injectable：注册为 Nest 服务；Inject：显式指定注入 token（tsx 会丢元数据，必须写）。
// OnModuleInit / OnModuleDestroy：启动/关闭生命周期钩子接口。
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
// PrismaService：查数据库（自愈时找卡住的文档、失败收尾时更新文档状态）。
import { PrismaService } from '../prisma/prisma.service.js'
// IngestionService：真正的索引流水线（解析→切块→向量化→落库）在这里面。
import { IngestionService } from './ingestion.service.js'
// 队列生产者：启动自愈时往它里面补任务（addBulk）。
import { IngestionQueue } from './ingestion.queue.js'
// 队列名/前缀/连接配置与任务数据类型：必须与生产者侧完全一致，Queue 和 Worker 才能对上话。
import {
  BULL_KEY_PREFIX,
  INGESTION_QUEUE_NAME,
  buildBullConnection,
  ingestionJobId,
  type IngestionJobData,
} from './ingestion.queue.js'

/**
 * 文档索引 Worker（消费者）：从 Redis 队列取出任务并执行索引流水线。
 */
@Injectable()
export class IngestionWorker implements OnModuleInit, OnModuleDestroy {
  // 持有 BullMQ Worker 实例：onModuleInit 时创建，onModuleDestroy 时优雅关闭。
  private worker: Worker<IngestionJobData> | null = null

  constructor(
    // 三个依赖全部显式 @Inject：tsx watch（esbuild）会丢弃构造参数的类型元数据，
    // 缺了 @Inject 运行时会注入 undefined（项目已踩过的坑，必须逐个标注 token）。
    @Inject(PrismaService) private readonly prisma: PrismaService,
    // 注入业务服务：任务处理器里真正干活的就是它（幂等的索引流水线）。
    @Inject(IngestionService) private readonly ingestion: IngestionService,
    // 注入队列单例：启动自愈时用它把历史遗留的未完成文档重新入队。
    @Inject(IngestionQueue) private readonly queue: IngestionQueue,
  ) {}

  /**
   * 模块初始化完成（Prisma 等依赖已就绪）后自动调用：
   * 先启动 Worker 开始消费，再做启动自愈（重新入队历史遗留的未完成文档）。
   */
  async onModuleInit(): Promise<void> {
    // 第一步：创建 Worker（开始监听队列，有任务就会立刻消费）。
    this.createWorker()
    // 第二步：自愈。放在 Worker 启动之后——即使自愈入队失败（如 Redis 抖动），
    // 也只打日志不阻断应用启动；HTTP 服务与后续上传完全不受影响。
    await this.recoverOrphans()
  }

  /**
   * 创建 BullMQ Worker 并绑定各类事件监听。
   * 方法体在 onModuleInit 里调用一次；单独抽出来是为了让 onModuleInit 保持清晰。
   */
  private createWorker(): void {
    // new Worker(队列名, 处理器函数, 配置)：
    // BullMQ 会自动从 Redis 队列取任务，把任务对象交给处理器函数执行；
    // 处理器抛出异常 = 本次尝试失败，BullMQ 按 attempts/backoff 自动安排重试。
    this.worker = new Worker<IngestionJobData>(
      // 第 1 个参数：监听的队列名（必须与生产者 IngestionQueue 的名字一致）。
      INGESTION_QUEUE_NAME,
      // 第 2 个参数：处理器函数（processor）。
      // 刻意写得极薄：成功路径完全交给 process()（内部事务把状态置 COMPLETED）；
      // 失败路径直接向上抛——BullMQ 感知到异常才会触发重试，
      // 状态收尾（PENDING/ERROR）统一放在下面的 'failed' 事件里，职责单一。
      async job => {
        // 只带 documentId 来；文件二进制留在 SQLite，process() 自己去查。
        await this.ingestion.process(job.data.documentId)
      },
      // 第 3 个参数：Worker 配置。
      {
        // prefix：Redis 键前缀，必须与 Queue 的一致，否则两边各玩各的对不上。
        prefix: BULL_KEY_PREFIX,
        // connection：BullMQ 自建的 Redis 连接（配置对象，不传现成实例）。
        connection: buildBullConnection(),
        // concurrency：同时处理几个任务。固定 1 = 串行消费，
        // 避免“解析+逐块向量化”并发打爆 Ollama（多文档时自动排队，速度换稳定）。
        concurrency: 1,
        // lockDuration：任务锁的持有时长。默认 30 秒对“解析 PDF + 逐块 embedding”
        // 的慢任务太短，会被误判成“掉线”（stalled）而重复执行，这里放宽到 10 分钟。
        lockDuration: 10 * 60 * 1000,
      },
    )
    // 事件：任务开始处理。打一行日志，方便在开发终端观察流水线进度。
    this.worker.on('active', job => {
      console.log(
        `[ingestion-worker] 开始处理文档索引任务：${job.id}（第 ${job.attemptsMade + 1} 次）`,
      )
    })
    // 事件：任务成功完成。process() 内部事务已把文档置为 COMPLETED，这里只需留痕。
    this.worker.on('completed', job => {
      console.log(`[ingestion-worker] 文档索引完成：${job.id}`)
    })
    // 事件：Worker 本身出错（如 Redis 连接异常）。与 Queue 一样：
    // EventEmitter 不挂 'error' 监听的话，一个错误事件就会把整个进程崩掉，必须挂上。
    this.worker.on('error', error => {
      console.error(`[ingestion-worker] Worker 异常：${error.message}`)
    })
    // 事件：一次尝试失败（可能还会重试）。void 表示刻意不 await 事件回调里的 Promise；
    // 收尾逻辑见 onJobFailed：区分“还有重试机会”与“重试耗尽”。
    this.worker.on('failed', (job, error) => {
      void this.onJobFailed(job, error)
    })
  }

  /**
   * 一次尝试失败后的“状态收尾”：
   *   - 还会重试（任务状态变为 delayed/waiting）→ 文档置回 PENDING + 记录失败原因，
   *     前端刷新时显示“等待处理”，稍后重试开始又会变回“正在索引”；
   *   - 重试耗尽（任务状态定格 failed）→ 文档置 ERROR + 失败原因，等待用户处理。
   *
   * 为什么在事件里判断而不是在 processor 里数次数：
   *   BullMQ 的 attemptsMade 计数时机容易数错（processor 执行期间它还没自增）；
   *   而 'failed' 事件触发时任务已确定进入退避（delayed/waiting）或终局（failed），
   *   await job.getState() 拿到的是状态机真值，没有歧义。
   * @param job 失败的任务（极端场景如 stalled 检测时可能为 undefined，需判空）
   * @param error 处理器抛出的错误对象
   */
  private async onJobFailed(job: Job<IngestionJobData> | undefined, error: Error): Promise<void> {
    // 没有任务对象就无法定位文档，直接结束（理论上极少发生，防御性判空）。
    if (!job) return
    // 读取失败后的任务状态：delayed/waiting = 已排入下一次重试；failed = 重试耗尽终局。
    const state = await job.getState()
    // 统一的错误文案：把底层错误信息透传给前端展示（排查问题时一目了然）。
    const message = error instanceof Error ? error.message : String(error)
    try {
      if (state === 'delayed' || state === 'waiting') {
        // 还有重试机会：置回 PENDING（前端显示“等待处理”），errorMessage 注明会自动重试。
        // 下次尝试开始时 process() 开头的 update 会把它改成 PROCESSING 并清掉这条信息。
        await this.prisma.document.update({
          where: { id: job.data.documentId },
          data: { status: 'PENDING', errorMessage: `${message}（稍后自动重试）` },
        })
        console.warn(`[ingestion-worker] 任务失败，将自动重试：${job.id}（原因：${message}）`)
      } else {
        // 重试耗尽（终局失败）：置 ERROR 定格，errorMessage 留给前端展示失败原因。
        await this.prisma.document.update({
          where: { id: job.data.documentId },
          data: { status: 'ERROR', errorMessage: message },
        })
        console.error(`[ingestion-worker] 任务重试耗尽，最终失败：${job.id}（原因：${message}）`)
      }
    } catch (updateError) {
      // 收尾本身失败（如文档刚被用户删除，update 找不到记录）只打日志：
      // 不能让“状态收尾的小问题”反过来把 Worker 的处理流程再弄崩一次。
      console.error(`[ingestion-worker] 更新失败状态时出错：${String(updateError)}`)
    }
  }

  /**
   * 启动自愈：把数据库里卡在 PENDING/PROCESSING 的文档重新入队。
   *
   * 为什么需要它：API 进程崩溃/被强杀时，Redis 里的任务可能已消费掉但文档没处理完
   * （或队列数据本身丢了），这些文档会永远停在 PENDING/PROCESSING——
   * 应用每次启动时主动扫一遍并补任务，保证“最终一定被处理”的闭环。
   *
   * 与 jobId 去重的配合：入队时沿用 ingestionJobId(documentId) 规则，
   * 如果 Redis 里其实还有同 id 的存活任务（排队/延迟重试中），重复添加会被
   * BullMQ 静默忽略——两条路径都不会导致同一文档被重复消费。
   * process() 本身幂等（重跑先删旧切片再写新切片），重复执行也无害。
   */
  private async recoverOrphans(): Promise<void> {
    try {
      // 找出所有“未完成”的文档：PENDING（还没轮到处理）或 PROCESSING（处理中被中断）。
      const stuck = await this.prisma.document.findMany({
        where: { status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }, // 只需要 id，别把 content 二进制查进内存。
      })
      // 没有遗留文档就静默返回（绝大多数正常启动都走这条路径）。
      if (stuck.length === 0) return
      // 批量重新入队：name/data/opts 的含义与 upload() 里的 add() 一致，
      // jobId 同样用 index-<文档id>，与排队中的旧任务自动去重。
      await this.queue.addBulk(
        stuck.map(doc => ({
          name: 'index',
          data: { documentId: doc.id } satisfies IngestionJobData,
          opts: { jobId: ingestionJobId(doc.id) },
        })),
      )
      console.log(`[ingestion-worker] 启动自愈：已重新入队 ${stuck.length} 个未完成文档`)
    } catch (error) {
      // 自愈失败（如 Redis 未就绪）只告警不崩启动：Worker 已就绪，任务可由下次重启再补。
      console.error(
        `[ingestion-worker] 启动自愈失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * 应用关闭时优雅停止 Worker：
   * worker.close() 会停止领取新任务，并等待“正在处理的任务”跑完后再断开连接。
   * 代价是 Ctrl+C 后进程可能要等几秒到几分钟（当前任务较长时）——这是
   * “至少处理一次”语义的合理取舍；开发时等不及可再按一次 Ctrl+C 强杀，
   * 残留任务由 stalled 检测 + 下次启动自愈兜底闭环。
   */
  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined)
  }
}
