import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Tooltip } from 'antd';
import { subscribeAgentEvents } from '../../services/api';
import { workspaceService } from '../../services/workspace';
import {
  PlusIcon,
  RefreshCwIcon,
  TerminalSquareIcon,
  XIcon,
} from './WorkbenchIcons';

interface TerminalPanelProps {
  active: boolean;
  projectId: string;
  root: string;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ active, projectId, root }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef('');
  const offsetRef = useRef(0);
  const replayingRef = useRef(false);
  const bufferRef = useRef<any[]>([]);
  const autoOpenedRef = useRef(false);

  const [items, setItems] = useState<{ id: string; exited: boolean }[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');

  const listTerminals = useCallback(async () => {
    const r = await workspaceService.listTerminals(projectId);
    setItems(r);
    return r;
  }, [projectId]);

  const attachRef = useRef<(value: string, reset?: boolean) => Promise<void>>(async () => {});

  const handleData = useCallback((e: any) => {
    if (e.terminalId !== idRef.current || !termRef.current) return;
    if (replayingRef.current) return void bufferRef.current.push(e);
    if (e.offset <= offsetRef.current) return;
    if (e.from > offsetRef.current) return void attachRef.current(idRef.current, false);
    let rel = Math.max(0, offsetRef.current - e.from);
    if (
      rel > 0 &&
      rel < e.data.length &&
      e.data.charCodeAt(rel - 1) >= 0xd800 &&
      e.data.charCodeAt(rel - 1) <= 0xdbff &&
      e.data.charCodeAt(rel) >= 0xdc00 &&
      e.data.charCodeAt(rel) <= 0xdfff
    ) {
      rel -= 1;
    }
    termRef.current.write(e.data.slice(rel));
    offsetRef.current = e.offset;
  }, []);

  const attachTerminal = useCallback(
    async (value: string, reset = true) => {
      idRef.current = value;
      setSelected(value);
      replayingRef.current = true;
      bufferRef.current = [];
      if (reset) {
        offsetRef.current = 0;
        termRef.current?.reset();
      }
      try {
        const r = await workspaceService.readTerminal(projectId, value, offsetRef.current);
        if (idRef.current !== value) return;
        if (r.gap) termRef.current?.reset();
        termRef.current?.write(r.data);
        offsetRef.current = r.offset;
        if (r.exited) termRef.current?.write('\r\n\x1b[90m[终端进程已退出]\x1b[0m\r\n');
      } finally {
        replayingRef.current = false;
        for (const e of bufferRef.current.splice(0)) handleData(e);
      }
      if (active) {
        fitRef.current?.fit();
        termRef.current?.focus();
      }
    },
    [projectId, active, handleData],
  );

  attachRef.current = attachTerminal;

  const createAndAttachTerminal = useCallback(async () => {
    try {
      setError('');
      const t = await workspaceService.openTerminal(
        projectId,
        termRef.current?.cols || 100,
        termRef.current?.rows || 30,
      );
      await listTerminals();
      await attachTerminal(t.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId, listTerminals, attachTerminal]);

  useEffect(() => {
    const terminal = new Terminal({
      fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.35,
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: '#09090B',
        foreground: '#E4E4E7',
        cursor: '#A1A1AA',
        selectionBackground: 'rgba(255, 255, 255, 0.18)',
      },
    });
    const addon = new FitAddon();
    terminal.loadAddon(addon);
    terminal.open(hostRef.current!);
    termRef.current = terminal;
    fitRef.current = addon;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let queue = '';
    let unlisten: (() => void) | undefined;
    let inputTail = Promise.resolve();

    const input = terminal.onData((value) => {
      queue += value;
      if (!timer) {
        timer = setTimeout(() => {
          timer = undefined;
          const data = queue;
          const target = idRef.current;
          queue = '';
          if (target) {
            inputTail = inputTail
              .then(async () => {
                for (let at = 0; at < data.length; at += 16000) {
                  await workspaceService.inputTerminal(
                    projectId,
                    target,
                    data.slice(at, at + 16000),
                  );
                }
              })
              .catch((e) => {
                if (!disposed) setError(e instanceof Error ? e.message : String(e));
              });
          }
        }, 16);
      }
    });

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (hostRef.current?.offsetWidth) {
          addon.fit();
          if (idRef.current) {
            void workspaceService
              .resizeTerminal(projectId, idRef.current, terminal.cols, terminal.rows)
              .catch((e) => setError(e instanceof Error ? e.message : String(e)));
          }
        }
      }, 100);
    });
    observer.observe(hostRef.current!);

    void subscribeAgentEvents((payload) => {
      if (payload.kind === 'terminal.data') handleData(payload);
      if (payload.kind === 'terminal.exit') {
        if (payload.terminalId === idRef.current) {
          terminal.write('\r\n\x1b[90m[终端进程已退出]\x1b[0m\r\n');
        }
        void listTerminals().catch(() => {});
      }
    }).then((fn) => (disposed ? fn() : (unlisten = fn)));

    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(resizeTimer);
      unlisten?.();
      observer.disconnect();
      input.dispose();
      terminal.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (active) {
      void (async () => {
        try {
          setError('');
          const r = await listTerminals();
          const target =
            r.find((t) => t.id === idRef.current) || r.find((t) => !t.exited) || r[0];
          if (target) {
            await attachTerminal(target.id, target.id !== idRef.current);
          } else if (!autoOpenedRef.current) {
            autoOpenedRef.current = true;
            await createAndAttachTerminal();
          }
          fitRef.current?.fit();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
    }
  }, [active, listTerminals, attachTerminal, createAndAttachTerminal]);

  return (
    <div className="qibox-terminal-surface">
      {/* Sleek Integrated Dark Sub-Toolbar */}
      <div className="qibox-terminal-header">
        <div className="qibox-terminal-tabs no-scrollbar">
          {items.map((t, index) => {
            const isCurrent = t.id === selected;
            return (
              <div
                key={t.id}
                onClick={() =>
                  void attachTerminal(t.id).catch((e) =>
                    setError(e instanceof Error ? e.message : String(e)),
                  )
                }
                className={`qibox-terminal-tab-pill ${isCurrent ? 'is-active' : ''}`}
                title={`PTY ID: ${t.id} (${root})`}
              >
                <span
                  className="qibox-terminal-dot"
                  style={{ background: t.exited ? '#71717A' : '#10B981' }}
                />
                <span className="mono">bash #{index + 1}</span>
                <button
                  type="button"
                  className="qibox-terminal-tab-kill"
                  title="结束并关闭此终端进程"
                  onClick={(e) => {
                    e.stopPropagation();
                    void (async () => {
                      try {
                        await workspaceService.closeTerminal(projectId, t.id);
                        if (idRef.current === t.id) {
                          idRef.current = '';
                          setSelected('');
                          termRef.current?.reset();
                        }
                        const nextList = await listTerminals();
                        const nextActive = nextList.find((x) => !x.exited) || nextList[0];
                        if (nextActive && !idRef.current) {
                          await attachTerminal(nextActive.id);
                        }
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      }
                    })();
                  }}
                >
                  <XIcon size={10.5} />
                </button>
              </div>
            );
          })}

          <Tooltip title="新建 WSL2 bash 终端">
            <button
              type="button"
              className="qibox-terminal-action-btn"
              onClick={() => void createAndAttachTerminal()}
            >
              <PlusIcon size={13} />
              <span>新建</span>
            </button>
          </Tooltip>
        </div>

        <div className="qibox-terminal-actions">
          <span className="mono qibox-terminal-cwd" title={root}>
            <TerminalSquareIcon size={12} />
            <span>{root.split('/').pop() || root}</span>
          </span>

          <Tooltip title="发送中断信号 (Ctrl+C)">
            <button
              type="button"
              disabled={!selected}
              className="qibox-terminal-action-btn"
              onClick={() =>
                void workspaceService
                  .inputTerminal(projectId, selected, '\x03')
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              }
            >
              Ctrl+C
            </button>
          </Tooltip>

          <Tooltip title="清屏">
            <button
              type="button"
              disabled={!selected}
              className="qibox-terminal-action-btn"
              onClick={() => termRef.current?.clear()}
            >
              <RefreshCwIcon size={12} />
            </button>
          </Tooltip>
        </div>
      </div>

      {error && (
        <div className="qibox-terminal-error">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}>
            <XIcon size={12} />
          </button>
        </div>
      )}

      {/* Edge-to-Edge Xterm Viewport */}
      <div className="qibox-terminal-canvas" ref={hostRef} />
    </div>
  );
};

export default TerminalPanel;
