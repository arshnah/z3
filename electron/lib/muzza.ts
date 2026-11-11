import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { buildMuzzaArchive, parseMuzzaArchive, type MuzzaEvent, type MuzzaExportInput, type WithMuzzaDb } from '../../src/lib/muzza-codec';

export type { MuzzaEvent };

const nodeRequire = createRequire(import.meta.url);
const withDb: WithMuzzaDb = async (bytes, readOnly, work) => {
    const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
    const tmp = mkdtempSync(join(tmpdir(), 'zeta-muzza-'));
    const path = join(tmp, 'song.db');
    try {
        if (bytes) writeFileSync(path, bytes);
        const db = new DatabaseSync(path, { readOnly });
        try {
            db.exec('PRAGMA trusted_schema = OFF');
            return work({ exec: db.exec.bind(db), prepare: db.prepare.bind(db), export: () => readFileSync(path) });
        } finally {
            db.close();
        }
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
};

export async function buildMuzzaBackup(input: MuzzaExportInput) {
    return buildMuzzaArchive(input, withDb);
}

export async function parseMuzzaBackup(bytes: Uint8Array) {
    return parseMuzzaArchive(bytes, withDb);
}

export async function readMuzzaEventsFromDb(dbBytes: Uint8Array): Promise<MuzzaEvent[]> {
    return withDb(dbBytes, true, (db) => {
        const localById = new Map<string, boolean>();
        for (const r of db.prepare('SELECT id, isLocal FROM song').all() as any[]) {
            localById.set(r.id, !!r.isLocal);
        }
        const rows = db.prepare('SELECT songId, timestamp, playTime FROM event').all() as any[];
        return rows.map((e) => ({
            zetaId: e.songId.includes(':') ? e.songId : `${localById.get(e.songId) ? 'local' : 'yt'}:${e.songId}`,
            timestamp: Number(e.timestamp),
            playTimeMs: Number(e.playTime),
        }));
    });
}
