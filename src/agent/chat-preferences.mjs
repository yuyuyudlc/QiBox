import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ROOT, loadPolicy, validateAllowedTools} from '../core/policy.mjs';

const preferencesPath = path.join(ROOT, 'config/chat.local.json');
export const targetLanguages = {
  ja: '日语', en: '英语', 'zh-CN': '简体中文', 'zh-TW': '繁体中文',
  ko: '韩语', fr: '法语', de: '德语', es: '西班牙语', pt: '葡萄牙语', ru: '俄语',
};

function validate(value) {
  if (!value || typeof value.targetLanguage !== 'string' || !Object.hasOwn(targetLanguages, value.targetLanguage))
    throw Error('请选择支持的目标语言。');
  const {
    provider = 'codex',
    apiBaseUrl = 'https://api.deepseek.com',
    apiModel = 'deepseek-chat',
    apiKey = '',
    outputLanguage = 'zh-CN',
  } = value;
  if (typeof outputLanguage !== 'string' || !Object.hasOwn(targetLanguages, outputLanguage))
    throw Error('请选择支持的回复回译目标语言。');
  if (typeof value.model !== 'string' || value.model.length > 200 || /[\s\x00-\x1f]/.test(value.model))
    throw Error('请输入有效的模型名称，或留空以使用 Codex 默认模型。');
  if (!['none', 'codex', 'openai-compatible'].includes(provider)) throw Error('请选择支持的翻译方式。');
  let base;
  try { base = new URL(apiBaseUrl); } catch { throw Error('请输入有效的 API 基础地址。'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (!(base.protocol === 'https:' || (local && base.protocol === 'http:')) || base.username || base.password || base.search || base.hash)
    throw Error('API 基础地址应使用 HTTPS，本机服务也可使用 HTTP。');
  if (typeof apiModel !== 'string' || !apiModel || /\s/.test(apiModel)) throw Error('请输入 API 翻译模型名称。');
  if (typeof apiKey !== 'string' || /[^\x21-\x7e]/.test(apiKey)) throw Error('API 密钥格式无效。');
  validateAllowedTools(value.allowedTools);
  return {targetLanguage: value.targetLanguage, outputLanguage, model: value.model, allowedTools: value.allowedTools,
    provider, apiBaseUrl:base.href.replace(/\/+$/, ''), apiModel, apiKey};
}

export function publicChatPreferences({apiKey, ...prefs}) {
  return {...prefs, hasApiKey:Boolean(apiKey)};
}

export function readChatPreferences(file = preferencesPath, policy) {
  try {
    return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return validate({targetLanguage: 'ja', outputLanguage: 'zh-CN', model: '', allowedTools: (policy ?? loadPolicy()).chat.allowedTools});
  }
}

export function saveChatPreferences(value, file = preferencesPath) {
  const prefs = validate(value);
  if (value.apiKey === undefined && fs.existsSync(file)) {
    const previous = readChatPreferences(file);
    if (previous.apiBaseUrl === prefs.apiBaseUrl) prefs.apiKey = previous.apiKey;
  }
  if (prefs.provider === 'openai-compatible' && !prefs.apiKey) throw Error('请输入该接口的 API 密钥。');
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(prefs, null, 2) + '\n', {flag:'wx', mode:0o600});
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, {force:true});
  }
  return publicChatPreferences(prefs);
}
