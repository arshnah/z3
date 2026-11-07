<script lang="ts">
    import type { AlbumBase, Artist, MusicProvider } from "$lib/schema";
    import { splitArtistCredits } from "$lib/music-metadata";
    import { artistHref, collectionHref, openArtist, openCollection } from "$lib/actions";

    interface Props {
        artists?: readonly { id?: string; name: string; thumbnails?: Artist["thumbnails"] }[] | null;
        album?: AlbumBase | null;
        showAlbum?: boolean;
        providerHint?: MusicProvider;
    }

    let { artists = null, album = null, showAlbum = false, providerHint }: Props = $props();

    const credits = $derived(splitArtistCredits(artists));
</script>

<span class="artist-links">
    {#if credits.length}
        {#each credits as credit, i (credit.name + ":" + i)}
            {#if credit.name.toLowerCase() === "unknown artist"}
                <span>{credit.name}</span>
            {:else}
                <a
                    class="artist-link"
                    href={artistHref(credit, providerHint)}
                    title="Go to {credit.name}"
                    onclick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openArtist(credit, providerHint);
                    }}
                >{credit.name}</a>
            {/if}{#if credit.sep}<span class="sep">{credit.sep}</span>{/if}
        {/each}
    {:else}
        <span>Unknown artist</span>
    {/if}
    {#if showAlbum && album?.title}
        <span class="sep">{" · "}</span><a
            class="alb-link"
            href={collectionHref(album, credits[0]?.name)}
            title="Go to album {album.title}"
            onclick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openCollection(album, credits[0]?.name);
            }}
        >{album.title}</a>
    {/if}
</span>

<style>
    .artist-links {
        display: inline;
    }
    .artist-link,
    .alb-link {
        color: inherit;
        cursor: pointer;
        border-radius: 4px;
        transition: color 0.15s;
    }
    .artist-link:hover,
    .alb-link:hover {
        color: var(--text);
        text-decoration: underline;
        text-underline-offset: 2px;
    }
    .alb-link {
        color: var(--text-3);
    }
    .sep {
        white-space: pre;
    }
</style>
