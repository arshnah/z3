import initSqlJs, { type SqlValue } from 'sql.js';
import sqliteWasm from 'sql.js/dist/sql-wasm-browser.wasm?url';
import type { WithMuzzaDb } from '../muzza-codec';

let sqlite: ReturnType<typeof initSqlJs> | undefined;
export const withAndroidMuzzaDb: WithMuzzaDb = async (bytes, readOnly, work) => {
    const { Database } = await (sqlite ??= initSqlJs({ locateFile: () => sqliteWasm }).catch((error) => {
        sqlite = undefined;
        throw error;
    }));
    const db = new Database(bytes);
    try {
        db.run('PRAGMA trusted_schema = OFF');
        if (readOnly) db.run('PRAGMA query_only = ON');
        return work({
            exec: (sql) => { db.exec(sql); },
            export: () => db.export(),
            prepare: (sql) => {
                const read = (params: SqlValue[], first = false) => {
                    const statement = db.prepare(sql);
                    try {
                        statement.bind(params);
                        const rows: Record<string, SqlValue>[] = [];
                        while (statement.step()) {
                            rows.push(statement.getAsObject());
                            if (first) break;
                        }
                        return rows;
                    } finally {
                        statement.free();
                    }
                };
                return {
                    all: (...params: SqlValue[]) => read(params),
                    get: (...params: SqlValue[]) => read(params, true)[0],
                    run: (...params: SqlValue[]) => { db.run(sql, params); },
                };
            },
        });
    } finally {
        db.close();
    }
};
