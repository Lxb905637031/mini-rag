-- 把上传文件的存储位置从“本地磁盘”改为“数据库本身”：
--   1. 新增 content BLOB 列：保存文件的原始二进制内容；
--   2. path 列由 NOT NULL 改为可空：新上传的文档不再有磁盘路径，
--      旧记录的路径在回填（读盘写入 content）完成后置为 NULL。
-- SQLite 不支持 ALTER TABLE 修改列约束，因此按官方做法重建整张 Document 表。

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "knowledgeBaseId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "path" TEXT,
    "content" BLOB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- 逐列拷贝旧数据；content 新列先填 NULL（稍后由回填脚本写入文件内容）。
INSERT INTO "new_Document" ("id", "knowledgeBaseId", "originalName", "mimeType", "path", "content", "status", "errorMessage", "chunkCount", "createdAt", "updatedAt")
SELECT "id", "knowledgeBaseId", "originalName", "mimeType", "path", NULL, "status", "errorMessage", "chunkCount", "createdAt", "updatedAt" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
CREATE INDEX "Document_knowledgeBaseId_idx" ON "Document"("knowledgeBaseId");
CREATE INDEX "Document_status_idx" ON "Document"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
