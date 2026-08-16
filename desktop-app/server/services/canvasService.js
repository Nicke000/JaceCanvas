import { getDb, saveToFile } from '../db/index.js';
export const canvasService = {
    /** 获取所有项目列表 */
    getAllProjects() {
        const db = getDb();
        const results = db.exec('SELECT * FROM projects ORDER BY updated_at DESC');
        return rowsToObjects(results);
    },
    /** 根据ID获取项目 */
    getProjectById(id) {
        const db = getDb();
        const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
        stmt.bind([id]);
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
        }
        stmt.free();
        return undefined;
    },
    /** 创建或更新项目 */
    saveProject(project) {
        const db = getDb();
        const now = Date.now();
        const existing = this.getProjectById(project.id);
        if (existing) {
            db.run('UPDATE projects SET name = ?, canvas_data = ?, updated_at = ? WHERE id = ?', [project.name, JSON.stringify(project.canvasData), now, project.id]);
        }
        else {
            db.run('INSERT INTO projects (id, name, canvas_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [project.id, project.name, JSON.stringify(project.canvasData), now, now]);
        }
        saveToFile();
        return this.getProjectById(project.id);
    },
    /** 删除项目 */
    deleteProject(id) {
        const db = getDb();
        const before = this.getProjectById(id);
        if (!before)
            return false;
        db.run('DELETE FROM projects WHERE id = ?', [id]);
        db.run('DELETE FROM chat_messages WHERE project_id = ?', [id]);
        saveToFile();
        return true;
    },
    /** 获取项目的聊天消息 */
    getChatMessages(projectId) {
        const db = getDb();
        const stmt = db.prepare('SELECT * FROM chat_messages WHERE project_id = ? ORDER BY timestamp ASC');
        const messages = [];
        stmt.bind([projectId]);
        while (stmt.step()) {
            messages.push(stmt.getAsObject());
        }
        stmt.free();
        return messages;
    },
    /** 保存聊天消息 */
    saveChatMessage(msg) {
        const db = getDb();
        db.run('INSERT OR REPLACE INTO chat_messages (id, project_id, node_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)', [msg.id, msg.project_id, msg.node_id, msg.role, msg.content, msg.timestamp]);
        saveToFile();
        return msg;
    },
};
/** 将 sql.js exec 结果转为对象数组 */
function rowsToObjects(results) {
    if (results.length === 0)
        return [];
    const { columns, values } = results[0];
    return values.map((row) => {
        const obj = {};
        columns.forEach((col, i) => {
            obj[col] = row[i];
        });
        return obj;
    });
}
//# sourceMappingURL=canvasService.js.map