import { useEffect } from "react";
import { renderNewsVideoLocally } from "./shared/newsVideoRenderer";

declare global {
  interface Window {
    renderNewsVideoForAutomation?: (
      payload: any
    ) => Promise<{ base64: string; mimeType: string }>;
  }
}

export default function RenderWorker() {
  useEffect(() => {
    window.renderNewsVideoForAutomation = async (payload: any) => {
      const blob = await renderNewsVideoLocally(payload);
      console.log("[RenderWorker] blob size:", blob.size);
      console.log("[RenderWorker] blob type:", blob.type);

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();

        reader.onloadend = () => {
          const result = reader.result as string;

          const marker = ";base64,";
          const markerIndex = result.indexOf(marker);

          if (markerIndex === -1) {
            reject(new Error("Không tìm thấy phần base64 trong Data URL"));
            return;
          }

          resolve(result.slice(markerIndex + marker.length));
        };

        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      console.log("[RenderWorker] base64 length:", base64.length);

      return {
        base64,
        mimeType: blob.type || "video/webm",
      };
    };
  }, []);

  return <div>Render worker ready</div>;
}