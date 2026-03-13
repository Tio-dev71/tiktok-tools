import { GoogleGenAI, Modality, Type, VideoGenerationReferenceType } from "@google/genai";

export class GeminiService {
  private getApiKey(): string {
    try {
      // @ts-ignore
      const dynamicKey = process.env.API_KEY;
      if (dynamicKey && dynamicKey !== "MY_APP_URL" && dynamicKey !== "") {
        return dynamicKey;
      }
    } catch (e) {}

    try {
      // @ts-ignore
      const buildKey = process.env.GEMINI_API_KEY;
      if (buildKey && buildKey !== '') {
        return buildKey;
      }
    } catch (e) {}

    return "";
  }

  private getClient(): GoogleGenAI {
    return new GoogleGenAI({ apiKey: this.getApiKey() });
  }

  private async withRetry<T>(fn: () => Promise<T>, retries = 7, delay = 10000): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      const errStr = (err.message || "") + String(err) + (err.stack || "") + JSON.stringify(err);
      const isRetryable = 
        err.message?.includes('429') || 
        err.message?.includes('RESOURCE_EXHAUSTED') ||
        err.message?.includes('quota') ||
        err.message?.includes('503') ||
        err.message?.includes('UNAVAILABLE') ||
        errStr.toLowerCase().includes('429') ||
        errStr.toLowerCase().includes('resource_exhausted') ||
        errStr.toLowerCase().includes('quota exceeded') ||
        errStr.toLowerCase().includes('503') ||
        errStr.toLowerCase().includes('unavailable') ||
        (err.status === 429) ||
        (err.code === 429) ||
        (err.status === 503) ||
        (err.code === 503);
        
      if (isRetryable && retries > 0) {
        console.warn(`Service busy or rate limit hit (Error ${err.status || err.code}), retrying in ${delay}ms... (${retries} retries left)`);
        await new Promise(res => setTimeout(res, delay));
        return this.withRetry(fn, retries - 1, delay * 1.5);
      }
      throw err;
    }
  }

  async generateScript(content: string): Promise<string> {
    return this.withRetry(async () => {
      const ai = this.getClient();
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Hãy chuyển nội dung sau đây thành một kịch bản tin tức ngắn, súc tích, hấp dẫn (khoảng 60-90 từ, đảm bảo thời lượng đọc từ 26 đến 40 giây) bằng tiếng Việt. 
        Sử dụng ngôn ngữ báo chí hiện đại, sắc sảo, dứt khoát. Tránh các từ ngữ rườm rà, tập trung vào thông tin quan trọng nhất để phù hợp với phong cách đọc nhanh, hùng hồn của MC tin tức chuyên nghiệp.
        
        QUY TẮC QUAN TRỌNG ĐỂ TRÁNH BỊ TIKTOK KHÓA TÀI KHOẢN:
        Tuyệt đối KHÔNG sử dụng các từ ngữ sau trong kịch bản:
        1. Bạo lực: giết, sát hại, đánh nhau, máu me...
        2. Khiêu dâm hoặc nhạy cảm.
        3. Phân biệt đối xử: béo, gầy, xấu, lùn...
        4. Tên hoặc từ lóng thay thế các nền tảng khác: Phở bò, Sàn S, tóp tóp... (Hãy dùng từ ngữ trung tính).
        5. Thông tin cá nhân: Số điện thoại, Gmail, địa chỉ cụ thể.
        6. Khẳng định tuyệt đối: 100%, tốt nhất, hiệu quả ngay, cam kết, chắc chắn... (Hãy dùng từ ngữ khách quan).
        7. Cờ bạc, vay nóng, tài chính bất hợp pháp.
        
        BẮT BUỘC phải bắt đầu bằng một trong các câu hook sau đây (viết hoa), chọn câu phù hợp nhất với nội dung tin tức:
        - 🚨 TIN NÓNG
        - 🗓️ LỊCH VĨ MÔ TUẦN NÀY
        - 🗓️ LỊCH VĨ MÔ HÔM NAY
        - 🔍 CHECK VÍ TAY TO
        
        KHÔNG được sử dụng bất kỳ câu hook nào khác ngoài danh sách trên.
        MỖI CÂU TRONG KỊCH BẢN PHẢI KẾT THÚC BẰNG DẤU CHẤM RÕ RÀNG ĐỂ DỄ DÀNG TÁCH DÒNG.
        Chỉ trả về nội dung kịch bản, không kèm theo lời dẫn giải khác: \n\n${content}`,
        config: {
          temperature: 0.8,
        }
      });
      return response.text || "";
    });
  }

  async generateAudio(text: string): Promise<string> {
    return this.withRetry(async () => {
      const ai = this.getClient();
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `YÊU CẦU QUAN TRỌNG: Hãy đóng vai một nữ MC đài truyền hình miền Bắc Việt Nam chuyên nghiệp. 
        PHONG CÁCH ĐỌC: Đọc RẤT NHANH, nhịp điệu HÙNG HỒN, DỨT KHOÁT, ĐẦY NĂNG LƯỢNG. 
        Giọng đọc phải sắc xảo, phát âm chuẩn, rõ ràng từng chữ nhưng tuyệt đối KHÔNG ĐƯỢC CHẬM. 
        Hãy giữ tính "nóng hổi", dồn dập của một bản tin breaking news: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              // 'Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("Failed to generate audio");
      return base64Audio;
    });
  }

  async generateTitle(script: string): Promise<string> {
    return this.withRetry(async () => {
      const ai = this.getClient();
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Dựa vào kịch bản tin tức sau, hãy tạo một tiêu đề (headline) cực kỳ GIẬT GÂN, thu hút sự chú ý ngay lập tức.
        YÊU CẦU QUAN TRỌNG:
        1. Tiêu đề phải có độ dài vừa đủ để đọc trong CHÍNH XÁC 4-5 giây (khoảng 10-14 từ).
        2. Tiêu đề phải bao hàm đủ ý chính, mang tính "nóng hổi", thúc giục người xem.
        3. Tuyệt đối KHÔNG sử dụng từ "SỐC:" hoặc "Sốc:" ở đầu tiêu đề.
        4. Nội dung tiêu đề này sẽ được dùng làm câu Hook mở đầu video, nên hãy viết sao cho MC đọc lên nghe thật lôi cuốn.
        
        Chỉ trả về nội dung tiêu đề, không kèm theo bất kỳ lời dẫn giải nào: \n\n${script}`,
        config: {
          temperature: 0.9,
        }
      });
      return response.text?.replace(/[".]/g, '') || "";
    });
  }

  async generateImage(prompt: string, sourceImageBase64?: string, badge?: string): Promise<string> {
    return this.withRetry(async () => {
      const ai = this.getClient();
      const style = `The Economist style editorial political cartoon infographic, hand-drawn financial illustration, satirical macroeconomic artwork, vintage newspaper texture, sepia and muted tones, dramatic cross-hatching, high detail, professional editorial illustration`;
      
      const parts: any[] = [];
      // Stronger instruction for the badge to be integrated but legible
      const badgeInstruction = badge ? `\nCRITICAL: You MUST include the exact text and icon "${badge}" as a hand-drawn badge, stamp, or banner integrated into the artwork. The text must be legible and match the editorial cartoon style.` : "";
      
      // Extract numbers and symbols from prompt to emphasize them
      const numbersAndSymbols = prompt.match(/[\d.,$]+[MBT]?|BTC|USD|ETF|FED|SEC|tỷ USD|triệu USD|nghìn BTC/gi)?.join(', ') || "";
      const numberInstruction = numbersAndSymbols ? `\nIMPORTANT: You MUST clearly and accurately display these specific numbers/terms in the artwork using BOLD, LARGE, HAND-DRAWN typography: ${numbersAndSymbols}. They must be the focal point of the data visualization.` : "";

      if (sourceImageBase64) {
        // Re-styling mode (Thumbnail)
        const base64Data = sourceImageBase64.split(',')[1] || sourceImageBase64;
        parts.push({
          inlineData: {
            data: base64Data,
            mimeType: "image/png"
          }
        });
        parts.push({
          text: `Re-style this image to match the following style: ${style}. ${badgeInstruction} ${numberInstruction}
          CRITICAL: You MUST preserve the original characters, subjects, key details, and the original color palette from the source image. 
          DO NOT change the layout, composition, or core meaning. 
          ONLY apply the artistic "The Economist" texture, cross-hatching, and line-work. 
          The goal is a refined editorial version of the original, not a new creation.
          ASPECT RATIO: The output MUST be 3:4 (9:12 aspect ratio) to fit the news area.
          COMPOSITION: Keep all main subjects in the central 70% area. The surrounding 30% must be a minimalist, endless, solid-color or subtly textured background. DO NOT include any frames, borders, or edges.`
        });
      } else {
        // Generation mode
        parts.push({
          text: `Generate an image for a news story: ${prompt}. ${badgeInstruction} ${numberInstruction}
          Style: ${style}. 
          TEXT RULES: No Vietnamese text in the artwork except for the badge. Use English for labels. 
          ASPECT RATIO: 9:16 (Vertical).
          COMPOSITION: All main subjects must be in the central 70% area. The surrounding 30% must be a minimalist, endless, solid-color or subtly textured background. DO NOT include any frames, borders, or edges.
          Ensure the artwork feels like a professional political cartoon from The Economist.`
        });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts },
        config: {
          imageConfig: {
            aspectRatio: sourceImageBase64 ? "3:4" : "9:16",
          },
        },
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return part.inlineData.data;
        }
      }
      throw new Error("No image data returned from Gemini");
    });
  }
}
