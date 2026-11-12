export declare class HttpError extends Error {
    readonly statusCode: number;
    constructor(message: string, statusCode: number);
}
