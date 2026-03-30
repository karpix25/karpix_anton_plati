import { NextResponse } from "next/server";

type HeygenAvatarGroup = {
  id: string;
  name?: string;
  group_type?: string;
  preview_image?: string;
};

type HeygenAvatarLook = {
  id: string;
  name?: string;
  image_url?: string | null;
};

async function heygenFetch(path: string) {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    throw new Error("HEYGEN_API_KEY is not configured");
  }

  const response = await fetch(`https://api.heygen.com${path}`, {
    headers: {
      "X-Api-Key": apiKey,
    },
    cache: "no-store",
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `HeyGen request failed with status ${response.status}`);
  }

  return data;
}

export async function GET() {
  try {
    const groupsPayload = await heygenFetch("/v2/avatar_group.list");
    const groups: HeygenAvatarGroup[] = groupsPayload?.data?.avatar_group_list || [];

    const groupLookResults = await Promise.all(
      groups.map(async (group, index) => {
        try {
          const looksPayload = await heygenFetch(`/v2/avatar_group/${group.id}/avatars`);
          const looks: HeygenAvatarLook[] = looksPayload?.data?.avatar_list || [];

          return {
            avatar_id: group.id,
            avatar_name: group.name || group.id,
            folder_name: group.group_type || "HEYGEN",
            preview_image_url: group.preview_image || looks[0]?.image_url || "",
            is_active: true,
            sort_order: index,
            looks: looks.map((look, lookIndex) => ({
              look_id: look.id,
              look_name: look.name || `${group.name || group.id} look ${lookIndex + 1}`,
              preview_image_url: look.image_url || "",
              is_active: true,
              sort_order: lookIndex,
            })),
          };
        } catch (error) {
          console.error(`HeyGen group import failed for ${group.id}:`, error);
          return {
            avatar_id: group.id,
            avatar_name: group.name || group.id,
            folder_name: group.group_type || "HEYGEN",
            preview_image_url: group.preview_image || "",
            is_active: true,
            sort_order: index,
            looks: [],
          };
        }
      })
    );

    return NextResponse.json(groupLookResults);
  } catch (error) {
    console.error("HeyGen catalog GET error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 }
    );
  }
}
