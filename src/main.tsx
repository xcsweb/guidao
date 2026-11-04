import { createRoot } from 'react-dom/client';
import { App } from './App';
import { store } from './state/store';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('未找到根节点 #root');

if (import.meta.env.DEV) {
  (window as unknown as { __store: typeof store }).__store = store;
}

createRoot(root).render(<App />);
