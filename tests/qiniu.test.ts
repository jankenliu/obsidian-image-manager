import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageHostingConfig, QiniuConfig } from '../src/types';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock('obsidian', () => ({ requestUrl }));

import { QiniuUploader } from '../src/uploaders/qiniu';

function createHostingConfig(urlPrefix = 'cdn.example.com/bucket/'): ImageHostingConfig {
    const config: QiniuConfig = {
        accessKey: 'access-key',
        secretKey: 'secret-key',
        bucket: 'images',
        region: 'z0',
    };
    return {
        id: 'qiniu-test',
        name: 'Qiniu test',
        type: 'qiniu',
        enabled: true,
        config,
        uploadPath: '',
        urlPrefix,
    };
}

describe('QiniuUploader', () => {
    beforeEach(() => {
        requestUrl.mockReset();
        requestUrl.mockResolvedValue({
            status: 200,
            json: { key: 'global/Projects/A/中文 图#1?.png' },
            text: '',
        });
    });

    it('uses the logical template path in multipart data and encodes the public URL', async () => {
        const uploader = new QiniuUploader(
            createHostingConfig(),
            'global/{sourceDir}/{filename}.{ext}'
        );

        const result = await uploader.upload(new ArrayBuffer(0), '中文 图#1?.png', {
            sourcePath: 'Projects/A/中文 图#1?.png',
        });

        const request = requestUrl.mock.calls[0]?.[0] as { body: ArrayBuffer };
        const body = new TextDecoder().decode(request.body);
        expect(body).toContain('global/Projects/A/中文 图#1?.png');
        expect(result.url).toBe(
            'https://cdn.example.com/bucket/global/Projects/A/%E4%B8%AD%E6%96%87%20%E5%9B%BE%231%3F.png'
        );
    });

    it('fails before uploading when the public access URL base is missing', async () => {
        const uploader = new QiniuUploader(createHostingConfig(''));

        const result = await uploader.upload(new ArrayBuffer(0), 'photo.png');

        expect(result).toMatchObject({
            success: false,
            error: 'Public access URL base is required for Qiniu',
        });
        expect(requestUrl).not.toHaveBeenCalled();
    });

    it('lists hosted objects with QBox authorization and public URLs', async () => {
        requestUrl.mockResolvedValue({
            status: 200,
            json: {
                marker: '',
                items: [{
                    key: 'uploads/中文 图.png',
                    fsize: 2048,
                    putTime: 17_840_217_404_690_000,
                }],
            },
            text: '',
        });
        const uploader = new QiniuUploader(createHostingConfig());

        const images = await uploader.listImages();

        const request = requestUrl.mock.calls[0]?.[0] as {
            url: string;
            method: string;
            headers: Record<string, string>;
        };
        expect(request).toMatchObject({
            url: 'https://rsf.qbox.me/list?bucket=images&limit=1000',
            method: 'GET',
        });
        expect(request.headers.Authorization).toMatch(/^QBox access-key:/);
        expect(images).toEqual([expect.objectContaining({
            key: 'uploads/中文 图.png',
            name: '中文 图.png',
            size: 2048,
            url: 'https://cdn.example.com/bucket/uploads/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png',
        })]);
    });

    it('deletes an object using the Qiniu management API', async () => {
        requestUrl.mockResolvedValue({ status: 200, json: {}, text: '' });
        const uploader = new QiniuUploader(createHostingConfig());

        await uploader.deleteImage('uploads/中文 图.png');

        const request = requestUrl.mock.calls[0]?.[0] as {
            url: string;
            method: string;
            headers: Record<string, string>;
        };
        expect(request).toMatchObject({
            method: 'POST',
        });
        expect(request.url).toMatch(/^https:\/\/rs\.qbox\.me\/delete\//);
        expect(request.headers.Authorization).toMatch(/^QBox access-key:/);
    });
});
