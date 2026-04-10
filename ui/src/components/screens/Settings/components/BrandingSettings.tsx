import React, { ChangeEvent } from "react";
import { Settings, ProductMediaAsset } from "@/types";
import { Button } from "@/components/ui/button";

interface BrandingSettingsProps {
  draftSettings: Settings;
  setDraftSettings: React.Dispatch<React.SetStateAction<Settings>>;
  isUploadingProductVideo: boolean;
  selectedClientId: string | null;
  handleProductVideoUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  handleRemoveProductAsset: (assetId: string) => void;
}

export const BrandingSettings: React.FC<BrandingSettingsProps> = ({
  draftSettings,
  setDraftSettings,
  isUploadingProductVideo,
  selectedClientId,
  handleProductVideoUpload,
  handleRemoveProductAsset,
}) => {
  const assets = draftSettings.product_media_assets || [];

  return (
    <div className="space-y-4 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-6 shadow-sm">
      <div className="space-y-1">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Продукт и аудитория
        </div>
        <p className="text-sm text-muted-foreground">
          Базовый продуктовый контекст, который используется в сценариях, product clip и брендовой интеграции.
        </p>
      </div>

      <div className="grid gap-6">
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Описание продукта
          </label>
          <textarea
            value={draftSettings.product_info}
            onChange={(event) => setDraftSettings((prev) => ({ ...prev, product_info: event.target.value }))}
            rows={5}
            className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-primary/10 transition-shadow"
            placeholder="Опишите ваш продукт..."
          />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Tone of voice
            </label>
            <textarea
              value={draftSettings.brand_voice}
              onChange={(event) => setDraftSettings((prev) => ({ ...prev, brand_voice: event.target.value }))}
              rows={4}
              className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-primary/10 transition-shadow"
              placeholder="Как должен звучать бренд? (например: дерзко, профессионально...)"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Целевая аудитория
            </label>
            <textarea
              value={draftSettings.target_audience}
              onChange={(event) => setDraftSettings((prev) => ({ ...prev, target_audience: event.target.value }))}
              rows={4}
              className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-primary/10 transition-shadow"
              placeholder="Кто ваш идеальный клиент?"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Product keyword
          </label>
          <input
            value={draftSettings.product_keyword}
            onChange={(event) => setDraftSettings((prev) => ({ ...prev, product_keyword: event.target.value }))}
            className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/10 transition-shadow"
            placeholder="Например, Плати по миру"
          />
          <p className="text-xs text-muted-foreground">
            Если это слово или фраза встречается в сценарии, вместо генерации будет использован готовый product clip.
          </p>
        </div>

        <div className="space-y-4 rounded-2xl border border-white/70 bg-white p-5 shadow-inner">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Product assets
            </label>
            <p className="text-xs text-muted-foreground">
              Загрузите видео и фото. Фото автоматически станут 4-секундными клипами.
            </p>
          </div>

          <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
            <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-[#d6e0e8] bg-white px-6 py-3 text-sm font-semibold text-foreground transition hover:bg-[#f7fafc] hover:border-[#cbd5e1] active:scale-95">
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleProductVideoUpload}
                disabled={!selectedClientId || isUploadingProductVideo}
                multiple
              />
              {isUploadingProductVideo ? "Загружаю ассеты..." : "Загрузить видео и фото"}
            </label>
            <div className="text-xs font-medium text-muted-foreground bg-[#f8fafc] px-3 py-1.5 rounded-full">
              В пуле: {assets.length} ассетов
            </div>
          </div>

          {assets.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {assets.map((asset) => (
                <div key={asset.id} className="group relative space-y-2 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-3 transition-all hover:bg-white hover:shadow-md">
                  <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl border border-[#e5ebf0] bg-black">
                    <video
                      src={asset.url}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 pointer-events-none">
                       <div className="rounded-full bg-white/20 p-2 backdrop-blur-sm">
                         <div className="h-8 w-8 rounded-full border-2 border-white/50" />
                       </div>
                    </div>
                  </div>
                  
                  <div className="space-y-1">
                    <div className="truncate text-xs font-bold text-foreground" title={asset.name}>{asset.name}</div>
                    <div className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground">
                      {asset.source_type === "image" ? "Фото -> видео 4s" : "Видео файл"}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setDraftSettings((prev) => ({
                          ...prev,
                          product_video_url: asset.url,
                        }))
                      }
                      className={`flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${
                        draftSettings.product_video_url === asset.url
                          ? "bg-primary/10 border-primary/20 text-primary"
                          : "border-[#d6e0e8] bg-white text-foreground hover:bg-[#f7fafc]"
                      }`}
                    >
                      {draftSettings.product_video_url === asset.url ? "Основной" : "Выбрать"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveProductAsset(asset.id)}
                      className="rounded-lg border border-rose-100 bg-white px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-500 transition hover:bg-rose-50 hover:border-rose-200"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#d6e0e8] bg-[#fbfcfd] px-4 py-8 text-center">
              <p className="text-sm font-medium text-muted-foreground">Пул ассетов пуст</p>
              <p className="mt-1 text-xs text-slate-400">Загрузите материалы для использования в роликах</p>
            </div>
          )}

          <div className="space-y-2 pt-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Fallback product URL
            </label>
            <input
              value={draftSettings.product_video_url}
              onChange={(event) => setDraftSettings((prev) => ({ ...prev, product_video_url: event.target.value }))}
              className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/10 transition-shadow"
              placeholder="/uploads/product-assets/..."
            />
            <p className="text-xs text-muted-foreground italic">
              Запасной URL, если пул ассетов пуст.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
