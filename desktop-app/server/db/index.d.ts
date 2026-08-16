import { type Database as SqlJsDatabase } from 'sql.js';
/** 初始化数据库 */
export declare function initDatabase(): Promise<SqlJsDatabase>;
/** 获取数据库实例 */
export declare function getDb(): SqlJsDatabase;
/** 持久化到磁盘 */
export declare function saveToFile(): void;
export type { SqlJsDatabase };
