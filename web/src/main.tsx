import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './reader-settings.css';
import './media-previews.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
