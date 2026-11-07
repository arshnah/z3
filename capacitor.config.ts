import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.zeta.z3',
    appName: 'Zeta',
    webDir: 'build',
    loggingBehavior: 'none',
    android: { backgroundColor: '#07060b' },
    plugins: {
        SystemBars: { style: 'DARK', initialViewportFitValueHint: 'cover' },
        // The music providers require native HTTP (including request headers
        // that a WebView cannot send). No remote web app is loaded in the shell.
        CapacitorHttp: { enabled: true },
    },
};

export default config;
