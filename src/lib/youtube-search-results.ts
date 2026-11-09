export function ytSearchItems(result: any, sectionName: string, legacyName: string): any[] {
    const legacy = result?.[legacyName]?.contents;
    if (Array.isArray(legacy) && legacy.length) return legacy;
    const section = (result?.contents ?? []).find((item: any) =>
        String(item?.title?.toString?.() ?? item?.title ?? '').toLowerCase().includes(sectionName.toLowerCase()),
    );
    return Array.isArray(section?.contents) ? section.contents : [];
}
