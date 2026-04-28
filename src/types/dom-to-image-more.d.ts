declare module 'dom-to-image-more' {
  type DomToImageOptions = {
    width?: number;
    height?: number;
    bgcolor?: string;
    style?: Partial<CSSStyleDeclaration> & Record<string, string | undefined>;
  };

  const domToImage: {
    toPng(node: HTMLElement, options?: DomToImageOptions): Promise<string>;
  };

  export default domToImage;
}
