import { connect } from '@ephaptic/client';

import type { Routes } from '../../electron/main';
import { isAndroid } from './platform';

// Only load the mobile services on Android; desktop keeps its Electron IPC
// transport and never initializes the native filesystem or music clients.
export const client: Routes = isAndroid
    ? (await import('./android/client')).androidClient
    : connect();
