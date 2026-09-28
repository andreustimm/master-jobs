/**
 * A suíte de contrato da porta `ObjectStorage` (#327): a MESMA lista de
 * afirmações para todo adapter. É ela que sustenta "trocar
 * `JHO_STORAGE_DRIVER` não exige mudança de código" — o app só depende do que
 * está aqui, e um adapter que divergir em um ponto reprova aqui, não em
 * produção.
 *
 * Cada caso usa uma chave nova (`prefix`): a suíte roda contra MinIO de
 * verdade, onde o estado sobrevive entre casos.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ObjectStorage } from "../../src/core/storage/index.ts";

export type ContractTarget = {
  storage: ObjectStorage;
  /** Dois buckets que já existem: o segundo prova o isolamento entre eles. */
  buckets: readonly [string, string];
};

const bytes = (text: string) => new TextEncoder().encode(text);

export function describeStorageContract(label: string, target: () => ContractTarget): void {
  describe(`contrato ObjectStorage — ${label}`, () => {
    const fresh = () => `contrato/${randomUUID()}`;

    it("put devolve ETag, e head e get enxergam o mesmo objeto", async () => {
      const { storage, buckets } = target();
      const address = { bucket: buckets[0], key: `${fresh()}/foto.webp` };
      const body = bytes("conteúdo de teste — com acento");
      const put = await storage.putObject({
        ...address,
        body,
        contentType: "image/webp",
        metadata: { width: "512", height: "512" },
      });
      expect(put.etag).not.toBe("");

      const head = await storage.headObject(address);
      expect(head).toEqual({
        contentType: "image/webp",
        contentLength: body.byteLength,
        etag: put.etag,
        metadata: { width: "512", height: "512" },
      });

      const got = await storage.getObject(address);
      expect(got && Buffer.from(got.body).equals(Buffer.from(body))).toBe(true);
      expect(got?.contentType).toBe("image/webp");
      expect(got?.contentLength).toBe(body.byteLength);
      expect(got?.etag).toBe(put.etag);
      expect(got?.metadata).toEqual({ width: "512", height: "512" });
    });

    it("preserva os 256 valores de byte", async () => {
      const { storage, buckets } = target();
      const address = { bucket: buckets[0], key: `${fresh()}.bin` };
      const body = Uint8Array.from({ length: 256 }, (_, i) => i);
      await storage.putObject({ ...address, body, contentType: "application/octet-stream" });
      const got = await storage.getObject(address);
      expect(got && [...got.body]).toEqual([...body]);
    });

    it("chave inexistente é null em get e head, não exceção", async () => {
      const { storage, buckets } = target();
      const address = { bucket: buckets[0], key: `${fresh()}/nunca-existiu.webp` };
      expect(await storage.getObject(address)).toBeNull();
      expect(await storage.headObject(address)).toBeNull();
    });

    it("put na mesma chave substitui conteúdo, tipo, ETag e metadados", async () => {
      const { storage, buckets } = target();
      const address = { bucket: buckets[0], key: `${fresh()}/capa` };
      const first = await storage.putObject({
        ...address,
        body: bytes("primeiro"),
        contentType: "image/png",
        metadata: { origem: "upload" },
      });
      const second = await storage.putObject({ ...address, body: bytes("segundo, mais longo"), contentType: "image/webp" });
      expect(second.etag).not.toBe(first.etag);

      const got = await storage.getObject(address);
      expect(got && new TextDecoder().decode(got.body)).toBe("segundo, mais longo");
      expect(got?.contentType).toBe("image/webp");
      expect(got?.etag).toBe(second.etag);
      expect(got?.metadata).toEqual({});
    });

    it("delete remove o objeto e é idempotente", async () => {
      const { storage, buckets } = target();
      const address = { bucket: buckets[0], key: `${fresh()}/remover.webp` };
      await storage.putObject({ ...address, body: bytes("x"), contentType: "image/webp", metadata: { a: "b" } });
      await storage.deleteObject(address);
      expect(await storage.getObject(address)).toBeNull();
      expect(await storage.headObject(address)).toBeNull();
      await expect(storage.deleteObject(address)).resolves.toBeUndefined();
    });

    it("chaves com o mesmo prefixo e buckets diferentes não se misturam", async () => {
      const { storage, buckets } = target();
      const key = `${fresh()}/a`;
      await storage.putObject({ bucket: buckets[0], key, body: bytes("um"), contentType: "text/plain" });
      await storage.putObject({ bucket: buckets[0], key: `${key}/b`, body: bytes("dois"), contentType: "text/plain" });
      await storage.putObject({ bucket: buckets[1], key, body: bytes("três"), contentType: "text/plain" });

      await storage.deleteObject({ bucket: buckets[0], key });
      expect(await storage.getObject({ bucket: buckets[0], key })).toBeNull();
      const nested = await storage.getObject({ bucket: buckets[0], key: `${key}/b` });
      const other = await storage.getObject({ bucket: buckets[1], key });
      expect(nested && new TextDecoder().decode(nested.body)).toBe("dois");
      expect(other && new TextDecoder().decode(other.body)).toBe("três");
    });

    it("recusa endereço e metadado inválidos antes de falar com o provedor", async () => {
      const { storage, buckets } = target();
      const body = bytes("x");
      const bad = [
        { bucket: "Maiusculo", key: "a" },
        { bucket: ".metadata", key: "a" },
        { bucket: buckets[0], key: "/raiz" },
        { bucket: buckets[0], key: "a/../b" },
        { bucket: buckets[0], key: "" },
        { bucket: buckets[0], key: "espaço no meio" },
      ];
      for (const address of bad) {
        await expect(storage.putObject({ ...address, body, contentType: "image/webp" }), JSON.stringify(address)).rejects.toThrow(TypeError);
        await expect(storage.getObject(address)).rejects.toThrow(TypeError);
        await expect(storage.headObject(address)).rejects.toThrow(TypeError);
        await expect(storage.deleteObject(address)).rejects.toThrow(TypeError);
      }
      const address = { bucket: buckets[0], key: fresh() };
      await expect(storage.putObject({ ...address, body, contentType: "imagem" })).rejects.toThrow(TypeError);
      await expect(
        storage.putObject({ ...address, body, contentType: "image/webp", metadata: { Maiuscula: "x" } }),
      ).rejects.toThrow(TypeError);
      await expect(
        storage.putObject({ ...address, body, contentType: "image/webp", metadata: { local: "São Paulo" } }),
      ).rejects.toThrow(TypeError);
      expect(await storage.headObject(address)).toBeNull();
    });
  });
}
