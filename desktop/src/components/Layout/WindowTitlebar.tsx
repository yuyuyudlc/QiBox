import React, { useEffect, useState } from 'react';
import { App } from 'antd';
import { CloseOutlined, MinusOutlined, BorderOutlined, CopyOutlined } from '@ant-design/icons';
import { getCurrentWindow } from '@tauri-apps/api/window';
import logo from '../../assets/qibox.svg';

export default function WindowTitlebar() {
  const [maximized, setMaximized] = useState(false);
  const { message } = App.useApp();

  useEffect(() => {
    const window = getCurrentWindow();
    const update = async () => setMaximized(await window.isMaximized());
    void update();
    const listening = window.onResized(update);
    return () => { void listening.then(unlisten => unlisten()); };
  }, []);

  const control = async (action: 'minimize' | 'toggleMaximize' | 'close') => {
    try {
      await getCurrentWindow()[action]();
      if (action === 'toggleMaximize') setMaximized(await getCurrentWindow().isMaximized());
    } catch {
      void message.error('窗口操作失败，请重试。');
    }
  };

  return (
    <header className="window-titlebar">
      <div className="window-drag-region" data-tauri-drag-region>
        <img src={logo} alt="" width={26} height={26} draggable={false} />
        <span className="window-brand">栖盒 <span>Qibox</span></span>
      </div>
      <div className="window-controls">
        <button type="button" aria-label="最小化窗口" title="最小化" onClick={() => void control('minimize')}><MinusOutlined /></button>
        <button type="button" aria-label={maximized ? '还原窗口' : '最大化窗口'} title={maximized ? '还原' : '最大化'} onClick={() => void control('toggleMaximize')}>
          {maximized ? <CopyOutlined /> : <BorderOutlined />}
        </button>
        <button type="button" className="window-close" aria-label="关闭窗口" title="关闭" onClick={() => void control('close')}><CloseOutlined /></button>
      </div>
    </header>
  );
}
