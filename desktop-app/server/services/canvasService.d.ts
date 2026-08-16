export interface ProjectRecord {
    id: string;
    name: string;
    canvas_data: string;
    created_at: number;
    updated_at: number;
}
export interface ChatMessageRecord {
    id: string;
    project_id: string;
    node_id: string | null;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}
export declare const canvasService: {
    /** 获取所有项目列表 */
    getAllProjects(): ProjectRecord[];
    /** 根据ID获取项目 */
    getProjectById(id: string): ProjectRecord | undefined;
    /** 创建或更新项目 */
    saveProject(project: {
        id: string;
        name: string;
        canvasData: unknown;
    }): ProjectRecord;
    /** 删除项目 */
    deleteProject(id: string): boolean;
    /** 获取项目的聊天消息 */
    getChatMessages(projectId: string): ChatMessageRecord[];
    /** 保存聊天消息 */
    saveChatMessage(msg: ChatMessageRecord): ChatMessageRecord;
};
