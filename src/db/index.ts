import { Pool } from 'pg';

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const result = await db.query(text, params);
  return result.rows;
}
