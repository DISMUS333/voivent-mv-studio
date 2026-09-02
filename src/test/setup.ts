//==============================================================================
// Vitest jsdom 環境用ポリフィル（Canvas 2D / WebGL / LocalStorage モック）
//==============================================================================

if (typeof window !== 'undefined') {
    // LocalStorage ポリフィル
    let store: Record<string, string> = {};
    const localStorageMock = {
        getItem: (key: string): string | null => (key in store ? store[key] : null),
        setItem: (key: string, value: string): void => {
            store[key] = String(value);
        },
        removeItem: (key: string): void => {
            delete store[key];
        },
        clear: (): void => {
            store = {};
        },
        get length(): number {
            return Object.keys(store).length;
        },
        key: (index: number): string | null => Object.keys(store)[index] ?? null,
    };

    Object.defineProperty(window, 'localStorage', {
        value: localStorageMock,
        writable: true,
    });
    if (typeof globalThis !== 'undefined') {
        Object.defineProperty(globalThis, 'localStorage', {
            value: localStorageMock,
            writable: true,
        });
    }

    // HTMLCanvasElement.getContext の安全なスタブ
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as any).getContext = function (contextType: string, ...args: unknown[]) {
        if (contextType === '2d') {
            return {
                fillRect: () => {},
                clearRect: () => {},
                getImageData: () => ({ data: new Uint8ClampedArray(4) }),
                putImageData: () => {},
                createImageData: () => ({ data: new Uint8ClampedArray(4) }),
                setTransform: () => {},
                drawImage: () => {},
                save: () => {},
                fillText: () => {},
                restore: () => {},
                beginPath: () => {},
                moveTo: () => {},
                lineTo: () => {},
                closePath: () => {},
                stroke: () => {},
                fill: () => {},
                measureText: () => ({ width: 0 }),
                fillStyle: '',
                strokeStyle: '',
                lineWidth: 1,
            } as unknown as CanvasRenderingContext2D;
        }
        if (contextType === 'webgl' || contextType === 'webgl2' || contextType === 'experimental-webgl') {
            return {
                getExtension: () => null,
                getParameter: () => 0,
                createShader: () => ({}),
                shaderSource: () => {},
                compileShader: () => {},
                createProgram: () => ({}),
                attachShader: () => {},
                linkProgram: () => {},
                useProgram: () => {},
                createBuffer: () => ({}),
                bindBuffer: () => {},
                bufferData: () => {},
                viewport: () => {},
                clearColor: () => {},
                clear: () => {},
                enable: () => {},
                disable: () => {},
            } as unknown as WebGLRenderingContext;
        }
        return originalGetContext ? (originalGetContext as (...a: unknown[]) => unknown).apply(this, [contextType, ...args]) as never : null;
    };
}
