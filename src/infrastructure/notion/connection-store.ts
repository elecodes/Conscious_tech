import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink, chmod } from "node:fs/promises";
import path from "node:path";

/** Local single-server vault. No tokens enter IndexedDB, browser storage or backups. */
export class NotionConnectionStore {
  constructor(private directory: string) {}
  private keyValue?: Promise<Buffer>;
  private key(): Promise<Buffer> {
    return (this.keyValue ??= this.loadKey().catch((error) => {
      this.keyValue = undefined;
      throw error;
    }));
  }
  private async loadKey() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const file = path.join(this.directory, "key");
    try {
      await writeFile(file, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const key = await readFile(file);
    if (key.length !== 32) throw new Error("Invalid Notion vault key");
    return key;
  }
  private file(id: string) {
    return path.join(this.directory, createHash("sha256").update(id).digest("hex") + ".enc");
  }
  async read<T>(id: string): Promise<T | null> {
    const key = await this.key();
    let bytes: Buffer;
    try {
      bytes = await readFile(this.file(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")
    ) as T;
  }
  async write(id: string, value: unknown) {
    const key = await this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    const file = this.file(id);
    const tmp = file + "." + randomBytes(8).toString("hex");
    await writeFile(tmp, Buffer.concat([iv, cipher.getAuthTag(), body]), { mode: 0o600 });
    await rename(tmp, file);
  }
  async remove(id: string) {
    try {
      await unlink(this.file(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
