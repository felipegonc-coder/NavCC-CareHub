// /api/meetings: private transcription (Meetings spec, section 3): the speech model files the
// browser runs it with. See ../README.md.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../../core/errors';
import { readSettings } from '../../../core/settings';
import { modelHeaders, modelsStatus, openModelFile } from './models';

export const modelSettingsSchema = z.object({ MODELS_DIR: z.string().optional() });

export interface TranscriptsRoutesOptions {
  /** The model files' folder: MODELS_DIR unless given. Null switches transcription off. */
  modelsDir?: string | null;
}

const fileParams = z.object({ file: z.string() });

const transcriptsRoutes: FastifyPluginAsync<TranscriptsRoutesOptions> = async (app, options) => {
  const modelsDir =
    options.modelsDir !== undefined
      ? options.modelsDir
      : (readSettings(modelSettingsSchema, { log: app.log }).MODELS_DIR ?? null);
  // Members only: guests and people outside the workspace get 403.
  app.addHook('preHandler', app.requireMember);

  // Whether transcription is set up, and how much the browser downloads once to run it.
  app.get('/transcription', async () => {
    const status = await modelsStatus(modelsDir);
    return status.available ? status : { ...status, message: "Transcription isn't set up yet." };
  });

  // A model file, read only from the folder: anything else is 404.
  app.get('/models/:file', async (request, reply) => {
    const { file } = fileParams.parse(request.params);
    const opened = modelsDir ? await openModelFile(modelsDir, file) : null;
    if (!opened) throw httpError(404, 'not_found');
    const { handle, ...model } = opened;
    const headers = modelHeaders(model);
    reply.headers(headers);
    if (request.headers['if-none-match'] === headers.etag) {
      await handle.close();
      return reply.code(304).send();
    }
    reply.header('content-length', model.size);
    return reply.send(handle.createReadStream());
  });
};

export default transcriptsRoutes;
