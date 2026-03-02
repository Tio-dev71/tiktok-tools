import { GoogleGenAI, Modality, Type, VideoGenerationReferenceType } from "@google/genai";

export class GeminiService {
  private getApiKey(): string {
    // Try to get the dynamic API_KEY injected by the platform
    try {
      // @ts-ignore
      const dynamicKey = process.env.API_KEY;
      if (dynamicKey && dynamicKey !== "MY_APP_URL" && dynamicKey !== "") {
        return dynamicKey;
      }
    } catch (e) {
      // process might not be defined in some environments
    }

    // Fallback to the build-time GEMINI_API_KEY (usually the free tier)
    return process.env.GEMINI_API_KEY || "";
  }

  private getClient(): GoogleGenAI {
    return new GoogleGenAI({ apiKey: this.getApiKey() });
  }

  private async withRetry<T>(fn: () => Promise<T>, retries = 4, delay = 5000): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      const errStr = String(err) + (err.stack || "") + JSON.stringify(err);
      const isRateLimit = 
        err.message?.includes('429') || 
        err.message?.includes('RESOURCE_EXHAUSTED') ||
        errStr.includes('429') ||
        errStr.includes('RESOURCE_EXHAUSTED') ||
        (err.status === 429) ||
        (err.code === 429);
        
      if (isRateLimit && retries > 0) {
        console.log(`Rate limit hit, retrying in ${delay}ms... (${retries} retries left)`);
        await new Promise(res => setTimeout(res, delay));
        return this.withRetry(fn, retries - 1, delay * 2);
      }
      throw err;
    }
  }

  async generateScript(content: string): Promise<string> {
    return this.withRetry(async () => {
      const ai = this.getClient();
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Hãy chuyển nội dung sau đây thành một kịch bản tin tức ngắn, súc tích, hấp dẫn (khoảng 50-100 từ) bằng tiếng Việt. 
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
        - TIN NÓNG
        - LỊCH VĨ MÔ TUẦN NÀY
        - LỊCH VĨ MÔ HÔM NAY
        - CHECK VÍ TAY TO
        
        KHÔNG được sử dụng bất kỳ câu hook nào khác ngoài danh sách trên.
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
        contents: `Dựa vào kịch bản tin tức sau, hãy tạo một tiêu đề (headline) cực kỳ GIẬT GÂN, thu hút sự chú ý ngay lập tức (clickbait nhưng đúng sự thật).
        YÊU CẦU QUAN TRỌNG:
        1. Tiêu đề phải dài khoảng 11-14 từ. Không được quá ngắn, không được cụt ngủn.
        2. Tiêu đề phải bao hàm đủ ý chính, mang tính "nóng hổi", thúc giục người xem.
        3. Tuyệt đối KHÔNG sử dụng từ "SỐC:" hoặc "Sốc:" ở đầu tiêu đề. Hãy bắt đầu trực tiếp bằng nội dung quan trọng nhất.
        
        Chỉ trả về nội dung tiêu đề, không kèm theo bất kỳ lời dẫn giải nào: \n\n${script}`,
        config: {
          temperature: 0.9,
        }
      });
      return response.text?.replace(/[".]/g, '') || "";
    });
  }
}
