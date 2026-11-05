import React from 'react';
import { Button, Form, Select, Space, Typography } from 'antd';
import { useAgent } from '../../contexts/AgentContext';
import { useConsole } from '../../contexts/ConsoleContext';
import { SwitchRow } from '../Common';
import { getSessionModelLabel, PERMISSION_MODES } from '../../services/types';

export const SessionSettings: React.FC = () => {
  const { snapshot } = useConsole();
  const { activeSession, isBusy, changePermissionMode, showTools, setShowTools, showChinese, setShowChinese, translateOutput, setTranslateOutput, translatorStatus, checkTranslator } = useAgent();
  const translationDisabled = snapshot?.chatPreferences.provider === 'none';
  const outputLang = snapshot?.chatPreferences.outputLanguage || 'zh-CN';
  const outputLangFull = snapshot?.targetLanguages[outputLang] || '简体中文';
  const outputLangShort = outputLang === 'zh-CN' ? '中文' : outputLangFull;

  return (
    <Form layout="vertical" className="session-settings">
      <Form.Item label="当前会话模型">
        <Typography.Text aria-label="Claude 模型">{getSessionModelLabel(activeSession)}</Typography.Text>
      </Form.Item>
      <Form.Item label="当前会话权限">
        <Select aria-label="权限模式" value={activeSession?.permissionMode || 'default'} disabled={!activeSession || isBusy} onChange={(mode) => void changePermissionMode(mode)} options={Object.entries(PERMISSION_MODES).map(([value, label]) => ({ value, label }))} />
      </Form.Item>
      <SwitchRow title="工具记录" desc="在对话中显示工具执行详情。" checked={showTools} onChange={setShowTools} />
      <SwitchRow title={`回译${outputLangShort}`} desc={translationDisabled ? '已在“对话与翻译”中关闭翻译服务。' : `将 Claude 回复翻译为${outputLangFull}。`} checked={!translationDisabled && translateOutput} disabled={translationDisabled} onChange={setTranslateOutput} borderTop />
      <SwitchRow title={`${outputLangShort}优先`} desc={translationDisabled ? '已关闭翻译服务，直接显示原文。' : `优先显示${outputLangFull}译文，原文可在消息中展开。`} checked={!translationDisabled && showChinese} disabled={translationDisabled} onChange={setShowChinese} borderTop />
      <Space style={{ marginTop: 20 }} wrap>
        <Typography.Text type="secondary">翻译状态：{translatorStatus}</Typography.Text>
        <Button disabled={translationDisabled} onClick={() => void checkTranslator()}>检查翻译连接</Button>
      </Space>
    </Form>
  );
};

export default SessionSettings;
