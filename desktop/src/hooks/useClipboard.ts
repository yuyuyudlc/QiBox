import { useCallback, useRef, useState } from 'react';
import { App } from 'antd';

export function useClipboard(resetDelayMs = 2000) {
  const { message } = App.useApp();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyText = useCallback(
    async (text: string, key = 'default', successTip = '已复制到剪贴板') => {
      if (!text) return false;
      try {
        await navigator.clipboard.writeText(text);
        setCopiedKey(key);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopiedKey(null), resetDelayMs);
        if (successTip) message.success(successTip);
        return true;
      } catch {
        message.error('复制失败，请检查剪贴板权限');
        return false;
      }
    },
    [message, resetDelayMs],
  );

  return { copiedKey, isCopied: (key = 'default') => copiedKey === key, copyText };
}

/**
 * 面板异步操作通用状态钩子（统一管理 busy / error / note）
 */
export function useTaskRunner() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const lockRef = useRef(false);

  const run = useCallback(async (fn: () => Promise<void>, onFinally?: () => void) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy(true);
    setError('');
    setNote('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      lockRef.current = false;
      setBusy(false);
      onFinally?.();
    }
  }, []);

  return { busy, error, note, setError, setNote, run };
}

export function readFileAsBase64(file: File): Promise<{
  base64: string;
  dataUrl: string;
  name: string;
  size: number;
  type: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      resolve({
        base64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
        dataUrl,
        name: file.name || `paste-${Date.now()}.png`,
        size: file.size,
        type: file.type || 'application/octet-stream',
      });
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

export function analyzePastedText(text: string) {
  const byteLength = new TextEncoder().encode(text).length;
  const lineCount = text.split(/\r?\n/).length;
  const isLongSnippet = text.length >= 1200 || lineCount >= 25;
  const looksLikeCodeOrLog =
    isLongSnippet &&
    !text.trim().startsWith('```') &&
    (/[{}();=>[\]]|^\s*(at\s+|Error:|Exception|Traceback|import\s+|const\s+|function\s+|def\s+|class\s+|\d{4}-\d{2}-\d{2})/m.test(
      text,
    ) ||
      lineCount >= 35);
  return { isLongSnippet, lineCount, byteLength, looksLikeCodeOrLog };
}
