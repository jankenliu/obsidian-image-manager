import { DEFAULT_UPLOAD_PATH_TEMPLATE } from '../types';
import { resolveUploadPath, selectUploadPathTemplate } from './upload-path';
import type { HostedImage, UploadResult, ImageHostingConfig, UploadContext } from '../types';

export abstract class UploaderBase {
    abstract readonly name: string;
    readonly supportsListing: boolean = false;
    protected config: ImageHostingConfig;
    private readonly globalUploadPathTemplate: string;

    constructor(config: ImageHostingConfig, globalUploadPathTemplate = DEFAULT_UPLOAD_PATH_TEMPLATE) {
        this.config = config;
        this.globalUploadPathTemplate = globalUploadPathTemplate;
    }

    /** 上传图片文件 */
    abstract upload(
        data: ArrayBuffer,
        filename: string,
        context?: UploadContext
    ): Promise<UploadResult>;

    /** 测试图床连接 */
    abstract testConnection(): Promise<boolean>;

    /** 列出图床中的图片；具体服务商按需实现 */
    listImages(): Promise<HostedImage[]> {
        return Promise.reject(new Error('Image listing is not supported by this provider'));
    }

    protected getUploadPathTemplate(): string {
        return selectUploadPathTemplate(this.config.uploadPath, this.globalUploadPathTemplate);
    }

    protected resolveUploadPath(
        filename: string,
        data?: ArrayBuffer,
        context?: UploadContext,
        template = this.getUploadPathTemplate()
    ): Promise<string> {
        return resolveUploadPath(template, filename, data, context);
    }
}
