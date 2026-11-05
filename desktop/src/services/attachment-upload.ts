type Rpc = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

export async function uploadAttachment(rpc: Rpc, projectId: string, path: string, base64: string) {
  let capabilities: { encodings: string[]; maxBase64Bytes: number };
  try {
    capabilities = await rpc('files.capabilities', { projectId });
  } catch (error) {
    if (error instanceof Error && error.message.includes('METHOD_NOT_ALLOWED')) {
      throw new Error('当前 WSL2 运行环境不支持二进制附件上传，请重启运行环境后重试。');
    }
    throw error;
  }
  if (!capabilities.encodings?.includes('base64')) {
    throw new Error('当前 WSL2 运行环境不支持二进制附件上传，请重启运行环境后重试。');
  }
  if (base64.length > capabilities.maxBase64Bytes) {
    throw new Error('附件超出直接上传大小限制，请直接将文件放入 WSL2 工作区目录。');
  }

  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const expectedRevision = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const result = await rpc<{ revision: string }>('files.write', {
    projectId, path, text: base64, revision: null, encoding: 'base64', mkdir: true,
  });
  if (result.revision !== expectedRevision) {
    throw new Error('附件内容校验失败，请更新隔离环境后重新上传。');
  }
  return result;
}
