import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Empty, Segmented, Switch, Tooltip, message } from 'antd';
import { workspaceService } from '../../services/workspace';
import { useTaskRunner } from '../../hooks/useClipboard';
import { NoticeAlerts } from '../Common';
import { useDraftState, useUnsavedChanges } from '../../hooks/useDraftState';
import {
  CheckIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from './WorkbenchIcons';

const SAMPLE_SERVER_ENTRY = {
  type: 'stdio',
  command: 'node',
  args: ['/opt/isolation/src/runtime/mcp-probe.mjs'],
  enabled: true,
};

interface McpPanelProps {
  active: boolean;
  projectId: string;
  sessionId: string;
}

export const McpPanel: React.FC<McpPanelProps> = ({ active, projectId, sessionId }) => {
  const { busy, error, note, setError, setNote, run } = useTaskRunner();
  const [editor, setEditor, ready] = useDraftState('mcp:editor', {
    text: '',
    revision: '',
    saved: '',
  });
  const { text, revision, saved } = editor;
  const setText = (nextText: string) => setEditor((old) => ({ ...old, text: nextText }));
  const isDirty = text !== saved;
  useUnsavedChanges(isDirty, 'mcp:editor');

  const [servers, setServers] = useState<any[]>([]);
  const [mode, setMode] = useState<'visual' | 'json'>('visual');

  const readConfig = useCallback(async () => {
    const r = await workspaceService.readMcp(projectId);
    const content = JSON.stringify(r.config, null, 2);
    setEditor({ text: content, saved: content, revision: r.revision });
  }, [projectId, setEditor]);

  const checkStatus = useCallback(async () => {
    if (!sessionId) return;
    setServers(await workspaceService.statusMcp(projectId, sessionId));
  }, [projectId, sessionId]);

  useEffect(() => {
    if (active && ready) {
      if (!revision) void run(() => readConfig());
      else if (sessionId) void run(() => checkStatus());
    }
  }, [active, sessionId, revision, run, readConfig, checkStatus, ready]);

  const parsedServers = useMemo(() => {
    try {
      const obj = JSON.parse(text || '{}');
      const map = obj?.mcpServers;
      if (!map || typeof map !== 'object') return [];
      return Object.entries(map).map(([name, cfg]: [string, any]) => ({
        name,
        type: cfg?.type || (cfg?.url ? 'http' : 'stdio'),
        command: cfg?.command || '',
        args: Array.isArray(cfg?.args) ? cfg.args : [],
        url: cfg?.url || '',
        enabled: cfg?.enabled !== false,
      }));
    } catch {
      return null;
    }
  }, [text]);

  const handleSave = async (customText?: string) => {
    const payloadStr = customText ?? text;
    await run(async () => {
      const parsed = JSON.parse(payloadStr);
      const r = await workspaceService.writeMcp(projectId, parsed, revision);
      const formatted = JSON.stringify(r.config, null, 2);
      setEditor({
        text: formatted,
        saved: formatted,
        revision: r.revision,
      });
      message.success('MCP 配置已保存');
    });
  };

  const handleToggleServerEnabled = (serverName: string, nextEnabled: boolean) => {
    try {
      const obj = JSON.parse(text || '{"mcpServers":{}}');
      if (!obj.mcpServers || typeof obj.mcpServers !== 'object') obj.mcpServers = {};
      if (!obj.mcpServers[serverName]) return;
      obj.mcpServers[serverName] = { ...obj.mcpServers[serverName], enabled: nextEnabled };
      const nextStr = JSON.stringify(obj, null, 2);
      setText(nextStr);
    } catch {
      setMode('json');
    }
  };

  const handleRemoveServer = (serverName: string) => {
    try {
      const obj = JSON.parse(text || '{"mcpServers":{}}');
      if (obj.mcpServers && typeof obj.mcpServers === 'object') {
        delete obj.mcpServers[serverName];
      }
      setText(JSON.stringify(obj, null, 2));
    } catch {
      setMode('json');
    }
  };

  const handleAddSampleServer = () => {
    try {
      const obj = JSON.parse(text || '{"mcpServers":{}}');
      if (!obj.mcpServers || typeof obj.mcpServers !== 'object') obj.mcpServers = {};
      const key = obj.mcpServers.diagnostic ? `diagnostic_${Date.now().toString().slice(-3)}` : 'diagnostic';
      obj.mcpServers[key] = SAMPLE_SERVER_ENTRY;
      setText(JSON.stringify(obj, null, 2));
    } catch {
      setMode('json');
    }
  };

  return (
    <div className="qibox-surface-container">
      {/* Sticky Sub-Toolbar */}
      <div className="qibox-surface-toolbar">
        <div className="qibox-surface-toolbar-left">
          <Segmented
            size="small"
            value={mode}
            onChange={(v) => setMode(v as 'visual' | 'json')}
            options={[
              { value: 'visual', label: `服务列表 (${parsedServers ? parsedServers.length : '?'})` },
              { value: 'json', label: 'JSON 配置' },
            ]}
          />
          <Tooltip title="插入本地诊断探测 MCP 示例">
            <button
              type="button"
              className="qibox-toolbar-ghost-btn"
              onClick={handleAddSampleServer}
            >
              <PlusIcon size={12} />
              <span>示例模板</span>
            </button>
          </Tooltip>
        </div>

        <div className="qibox-surface-toolbar-right">
          <Tooltip title="重新读取工作区配置">
            <button
              type="button"
              disabled={busy}
              className="qibox-workbench-icon-btn"
              onClick={() => void run(() => readConfig())}
            >
              <RefreshCwIcon size={13} spin={busy} />
            </button>
          </Tooltip>

          {isDirty && (
            <button
              type="button"
              disabled={busy || !revision}
              className="qibox-toolbar-primary-btn"
              onClick={() => void handleSave()}
            >
              <CheckIcon size={12.5} />
              <span>保存更改</span>
            </button>
          )}

          {sessionId && (
            <button
              type="button"
              disabled={busy || isDirty}
              className="qibox-toolbar-ghost-btn"
              onClick={() =>
                void run(async () => {
                  const r = await workspaceService.applyMcp(projectId, sessionId);
                  setServers(r.servers);
                  setNote(
                    r.errors.length
                      ? `部分 MCP 连接异常：${r.errors.join(', ')}`
                      : '已同步应用到当前活跃会话。',
                  );
                })
              }
              title={isDirty ? '请先保存更改后再应用到会话' : '热更新应用到当前会话'}
            >
              <span>应用到会话</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14 }}>
        <NoticeAlerts
          error={error}
          note={note}
          onClearError={() => setError('')}
          onClearNote={() => setNote('')}
        />

        {mode === 'visual' && parsedServers !== null ? (
          parsedServers.length === 0 ? (
            <div style={{ padding: '44px 16px', textAlign: 'center' }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="当前项目暂未配置 MCP 扩展服务"
              >
                <div style={{ display: 'inline-flex', gap: 8 }}>
                  <button
                    type="button"
                    className="qibox-toolbar-primary-btn"
                    onClick={handleAddSampleServer}
                  >
                    <PlusIcon size={13} />
                    <span>添加诊断示例服务</span>
                  </button>
                  <button
                    type="button"
                    className="qibox-toolbar-ghost-btn"
                    onClick={() => setMode('json')}
                  >
                    <span>直接编辑 JSON</span>
                  </button>
                </div>
              </Empty>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {parsedServers.map((srv) => {
                const runtimeState = servers.find((s) => s.name === srv.name);
                const isConnected = runtimeState?.status === 'connected';
                const toolNames: string[] =
                  runtimeState?.tools?.map((t: any) => t.name) || [];

                return (
                  <div key={srv.name} className="qibox-mcp-card">
                    <div className="qibox-mcp-card-top">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span className="qibox-hud-row-icon">
                          <PlugIcon size={14} />
                        </span>
                        <span style={{ fontWeight: 600, fontSize: 13, color: '#09090B' }}>
                          {srv.name}
                        </span>
                        <span className="qibox-mcp-badge mono">{srv.type}</span>
                        {runtimeState && (
                          <span
                            className="qibox-hud-live-pill"
                            style={{
                              background: isConnected ? '#ECFDF5' : '#F4F4F5',
                              color: isConnected ? '#059669' : '#71717A',
                            }}
                          >
                            <span
                              className="qibox-hud-live-dot"
                              style={{ background: isConnected ? '#10B981' : '#A1A1AA' }}
                            />
                            {runtimeState.status}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        {sessionId && runtimeState && (
                          <button
                            type="button"
                            disabled={busy}
                            className="qibox-toolbar-ghost-btn"
                            onClick={() =>
                              void run(async () => {
                                setServers(
                                  await workspaceService.reconnectMcp(
                                    projectId,
                                    sessionId,
                                    srv.name,
                                  ),
                                );
                              })
                            }
                          >
                            重连
                          </button>
                        )}
                        <Switch
                          size="small"
                          checked={srv.enabled}
                          onChange={(checked) => handleToggleServerEnabled(srv.name, checked)}
                        />
                        <Tooltip title="移除此服务">
                          <button
                            type="button"
                            className="qibox-workbench-icon-btn"
                            onClick={() => handleRemoveServer(srv.name)}
                          >
                            <XIcon size={13} />
                          </button>
                        </Tooltip>
                      </div>
                    </div>

                    <div className="qibox-mcp-card-cmd mono">
                      {srv.url
                        ? srv.url
                        : `${srv.command} ${srv.args.join(' ')}`.trim() || '(未填写启动命令)'}
                    </div>

                    {toolNames.length > 0 && (
                      <div className="qibox-mcp-card-tools">
                        <span style={{ color: '#71717A' }}>可用工具 ({toolNames.length})：</span>
                        <span className="mono">{toolNames.join(' · ')}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
            <div style={{ fontSize: 11.5, color: '#71717A' }}>
              stdio 命令在 WSL2 环境内运行。设置 <code>"enabled": false</code> 可停用服务；
              <code>__KEEP_SECRET__</code> 可保留已有环境变量密钥。
            </div>
            <textarea
              aria-label="MCP JSON 配置"
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="code-textarea"
              style={{ flex: 1, minHeight: 320, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default McpPanel;
