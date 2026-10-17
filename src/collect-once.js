// เก็บข้อมูลครั้งเดียวแล้วจบ (ใช้กับ cron ของระบบหรือรันเอง: npm run collect)
import * as store from './store.js';
import { collectMissing, provider } from './collector.js';

store.load(provider.name);
await collectMissing();
