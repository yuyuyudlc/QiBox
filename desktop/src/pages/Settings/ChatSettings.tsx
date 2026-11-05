import React from 'react';
import { Alert, Button, Card, Form, Input, Select, Space } from 'antd';
import SessionSettings from '../../components/Chat/SessionSettings';
import { useConsole } from '../../contexts/ConsoleContext';

const ChatSettings: React.FC = () => {
  const { snapshot, chatDraft, setChatDraft, saveChatDraft, busy } = useConsole();
  if (!snapshot || !chatDraft) return null;
  const translationDisabled = chatDraft.provider === 'none';

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <Card title="会话与显示" size="small"><SessionSettings /></Card>
      <Card title="翻译设置" size="small">
        <Form layout="vertical">
          <Form.Item label="翻译服务" htmlFor="translation-provider">
            <Select id="translation-provider" value={chatDraft.provider} options={[
              {value:'none', label:'关闭翻译（仅原文对话）'},
              {value:'codex', label:'本机 Codex'},
              {value:'openai-compatible', label:'OpenAI 兼容 API'},
            ]} onChange={provider => setChatDraft({...chatDraft, provider})} />
          </Form.Item>
          {translationDisabled ? (
            <Alert
              type="info"
              showIcon
              message="已关闭双语翻译，输入和 Claude 回复都将按原文直接发送与展示。"
              style={{ marginBottom: 16 }}
            />
          ) : (
            <>
              <Form.Item label="输入翻译目标语言" htmlFor="translation-target">
                <Select id="translation-target" value={chatDraft.targetLanguage}
                  options={Object.entries(snapshot.targetLanguages).map(([value,label]) => ({value,label}))}
                  onChange={targetLanguage => setChatDraft({...chatDraft,targetLanguage})} />
              </Form.Item>
              <Form.Item label="回复回译目标语言" htmlFor="translation-output-target" extra="将 Claude 的回复和历史消息翻译为该语言显示。">
                <Select id="translation-output-target" value={chatDraft.outputLanguage}
                  options={Object.entries(snapshot.targetLanguages).map(([value,label]) => ({value,label}))}
                  onChange={outputLanguage => setChatDraft({...chatDraft,outputLanguage})} />
              </Form.Item>
              {chatDraft.provider === 'openai-compatible' ? <>
                <Form.Item label="API 基础地址" htmlFor="translation-base" extra="填写服务商提供的基础地址，保留所需的 /v1 前缀。">
                  <Input id="translation-base" value={chatDraft.apiBaseUrl} onChange={e => setChatDraft({...chatDraft,apiBaseUrl:e.target.value})} />
                </Form.Item>
                <Form.Item label="API 模型" htmlFor="translation-api-model">
                  <Input id="translation-api-model" value={chatDraft.apiModel} onChange={e => setChatDraft({...chatDraft,apiModel:e.target.value})} />
                </Form.Item>
                <Form.Item label="API 密钥" htmlFor="translation-key" extra="密钥保存在本机配置中。待翻译的消息会发送至上方地址。">
                  <Input.Password id="translation-key" autoComplete="new-password" value={chatDraft.apiKey ?? ''}
                    placeholder={snapshot.chatPreferences.hasApiKey && chatDraft.apiBaseUrl === snapshot.chatPreferences.apiBaseUrl ? '已保存，留空沿用' : '输入 API 密钥'}
                    onChange={e => setChatDraft({...chatDraft,apiKey:e.target.value || undefined})} />
                </Form.Item>
              </> : <Form.Item label="Codex 翻译模型" htmlFor="translation-model">
                <Input id="translation-model" placeholder="使用本机 Codex 默认模型" value={chatDraft.model}
                  onChange={e => setChatDraft({...chatDraft,model:e.target.value})} />
              </Form.Item>}
            </>
          )}
          <Button type="primary" disabled={!!busy || JSON.stringify(chatDraft) === JSON.stringify(snapshot.chatPreferences)}
            onClick={() => void saveChatDraft()}>保存对话偏好</Button>
        </Form>
      </Card>
    </Space>
  );
};

export default ChatSettings;
