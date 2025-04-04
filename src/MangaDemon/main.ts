// TODO:
// - Add the English name to the title view
// - Add additional info to the title view
// - Make getChapterDetails only return new chapters
// - Fix exclude search

import {
  BasicRateLimiter,
  Chapter,
  ChapterDetails,
  ChapterProviding,
  Cookie,
  CookieStorageInterceptor,
  ContentRating,
  CloudflareError,
  CloudflareBypassRequestProviding,
  DiscoverSection,
  DiscoverSectionItem,
  DiscoverSectionProviding,
  DiscoverSectionType,
  Extension,
  MangaProviding,
  PagedResults,
  PaperbackInterceptor,
  Request,
  Response,
  SearchFilter,
  SearchQuery,
  SearchResultItem,
  SearchResultsProviding,
  SourceManga,
  Tag,
  TagSection,
} from "@paperback/types";
// Template content
import * as cheerio from "cheerio";
import content from "../../content.json";
import { CheerioAPI } from "cheerio";
import { URLBuilder } from "../utils/url-builder/base";

const DOMAIN_NAME = "https://demonicscans.org";

// Should match the capabilities which you defined in pbconfig.ts
type MangaDemonImplementation = Extension &
  DiscoverSectionProviding &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding;

// Intercepts all the requests and responses and allows you to make changes to them
class MainInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...(request.headers ?? {}),
      ...{
          'referer': `${DOMAIN_NAME}/`,
          'user-agent': await Application.getDefaultUserAgent()
      }
    }

    return request
  }

  override async interceptResponse(
      request: Request,
      response: Response,
      data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
      return data;
  }
}

// Main extension class
export class MangaDemonExtension implements MangaDemonImplementation {
  // Implementation of the main rate limiter
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 4,
    bufferInterval: 1,
    ignoreImages: true,
  });

  // Implementation of the main interceptor
  mainInterceptor = new MainInterceptor("main");

  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

  // Method from the Extension interface which we implement, initializes the rate limiter, interceptor, discover sections and search filters
  async initialise(): Promise<void> {
    this.cookieStorageInterceptor.registerInterceptor();
    this.mainRateLimiter.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const get_Most_Viewed_Today: DiscoverSection = {
      id: "most-viewed-today",
      title: "Most Viewed Today",
      type: DiscoverSectionType.featured,
    };

    const get_Our_Latest_Translations: DiscoverSection = {
      id: "our-latest-transalations",
      title: "Our Latest Translations",
      type: DiscoverSectionType.prominentCarousel,
    };

    const get_Latest_Updates: DiscoverSection = {
      id: "latest-updates",
      title: "Latest Updates",
      type: DiscoverSectionType.simpleCarousel,
    };

    const get_New_Titles: DiscoverSection = {
      id: "new-titles",
      title: "New Titles",
      type: DiscoverSectionType.simpleCarousel,
    };


    const get_Genre_Section: DiscoverSection = {
      id: "get-genre-section",
      title: "Genres",
      type: DiscoverSectionType.genres,
    };

    return [
      get_Most_Viewed_Today,
      get_Our_Latest_Translations,
      get_Latest_Updates,
      get_New_Titles,
      get_Genre_Section,
    ];
  }

  // Populates both the discover sections
  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: MangaDemon.Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case "most-viewed-today":
        return this.getMostViewedToday(metadata);
      case "our-latest-transalations":
        return this.getLatestTranslations(section, metadata);
      case "latest-updates":
        return this.getLatestUpdates(section, metadata);
      case "new-titles":
        return this.getNewTitles(section, metadata);
      case "get-genre-section":
        return this.getGenreSection();
      default:
        return { items: [] };
    }
  }

  async getMostViewedToday(
    metadata: { page?: number; collectedIds?: string[] } | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const items: DiscoverSectionItem[] = [];
    const collectedIds = metadata?.collectedIds ?? [];

    const request = {
      url: new URLBuilder(DOMAIN_NAME).build(),
      method: "GET",
    };

    const $ = await this.fetchCheerio(request);

    $("#carousel div.owl-item").each((_, element) => {
      const unit = $(element);

      const anchor = unit.find("div.owl-element > a");
      const href = anchor.attr("href") || "";
      const mangaId = href.match(/\/manga\/([^/?#]+)/)?.[1] || "";

      const image = anchor.find("img").attr("src") || "";
      const title = anchor.find("title").text().trim();

      const safeId = decodeURIComponent(mangaId)
        .replace(/[^\w@.]/g, "_")
        .trim();

      if (safeId && title && image && !collectedIds.includes(safeId)) {
        collectedIds.push(safeId);
        items.push(
          createDiscoverSectionItem({
            id: safeId,
            image: image,
            title: title,
            type: "simpleCarouselItem",
          }),
        );
      }
    });

    return {
      items: items,
      metadata: undefined,
    };
  }

  // Populate search filters
  async getSearchFilters(): Promise<SearchFilter[]> {
    return [
      {
        id: "search-filter-template",
        type: "dropdown",
        options: [
          { id: "include", value: "include" },
          { id: "exclude", value: "exclude" },
        ],
        value: "Exclude",
        title: "Search Filter Template",
      },
    ];
  }

  // Populates search
  async getSearchResults(
    query: SearchQuery,
    metadata?: number,
  ): Promise<PagedResults<SearchResultItem>> {
    void metadata;

    const results: PagedResults<SearchResultItem> = { items: [] };

    for (let i = 0; i < content.length; i++) {
      if (
        (content[i].primaryTitle
          .toLowerCase()
          .indexOf(query.title.toLowerCase()) != -1 &&
          query.filters[0].value == "include") ||
        (content[i].primaryTitle
          .toLowerCase()
          .indexOf(query.title.toLowerCase()) == -1 &&
          query.filters[0].value == "exclude")
      ) {
        if (content[i].titleId) {
          const result: SearchResultItem = {
            mangaId: content[i].titleId,
            title: content[i].primaryTitle
              ? content[i].primaryTitle
              : "Unknown Title",
            subtitle: content[i].secondaryTitles[0],
            imageUrl: content[i].thumbnailUrl
              ? content[i].thumbnailUrl
              : "",
          };
          results.items.push(result);
        }
      } else {
        for (let j = 0; j < content[i].secondaryTitles.length; j++) {
          if (
            (content[i].secondaryTitles[j]
              .toLowerCase()
              .indexOf(query.title.toLowerCase()) != -1 &&
              query.filters[0].value == "include") ||
            (content[i].secondaryTitles[j]
              .toLowerCase()
              .indexOf(query.title.toLowerCase()) == -1 &&
              query.filters[0].value == "exclude")
          ) {
            if (content[i].titleId) {
              const result: SearchResultItem = {
                mangaId: content[i].titleId,
                title: content[i].primaryTitle
                  ? content[i].primaryTitle
                  : "Unknown Title",
                subtitle: content[i].secondaryTitles[0],
                imageUrl: content[i].thumbnailUrl
                  ? content[i].thumbnailUrl
                  : "",
              };
              results.items.push(result);
            }
            break;
          }
        }
      }
    }
    return results;
  }

  // Populates the title details
  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    for (let i = 0; i < content.length; i++) {
      if (mangaId == content[i].titleId) {
        let contentRating: ContentRating;
        switch (content[i].contentRating) {
          case "ADULT":
            contentRating = ContentRating.ADULT;
            break;
          case "MATURE":
            contentRating = ContentRating.MATURE;
            break;
          default:
            contentRating = ContentRating.EVERYONE;
            break;
        }

        const genres: TagSection = {
          id: "genres",
          title: "Genres",
          tags: [],
        };
        for (let j = 0; j < content[i].genres.length; j++) {
          const genre: Tag = {
            id: content[i].genres[j]
              .toLowerCase()
              .replace(" ", "-"),
            title: content[i].genres[j],
          };
          genres.tags.push(genre);
        }

        const tags: TagSection = {
          id: "tags",
          title: "Tags",
          tags: [],
        };
        for (let j = 0; j < content[i].tags.length; j++) {
          const tag: Tag = {
            id: content[i].tags[j].toLowerCase().replace(" ", "-"),
            title: content[i].tags[j],
          };
          tags.tags.push(tag);
        }

        return {
          mangaId,
          mangaInfo: {
            thumbnailUrl: content[i].thumbnailUrl
              ? content[i].thumbnailUrl
              : "",
            synopsis: content[i].synopsis
              ? content[i].synopsis
              : "No synopsis.",
            primaryTitle: content[i].primaryTitle
              ? content[i].primaryTitle
              : "Unknown Title",
            secondaryTitles: content[i].secondaryTitles
              ? content[i].secondaryTitles
              : [],
            contentRating,
            status: content[i].status,
            author: content[i].author,
            rating: content[i].rating,
            tagGroups: [genres, tags],
            artworkUrls: [content[i].thumbnailUrl],
            shareUrl: content[i].url,
          },
        };
      }
    }
    throw new Error("No title with this id exists");
  }

  // Populates the chapter list
  async getChapters(
    sourceManga: SourceManga,
    sinceDate?: Date,
  ): Promise<Chapter[]> {
    // Can be used to only return new chapters. Not used here, instead the whole chapter list gets returned
    void sinceDate;

    for (let i = 0; i < content.length; i++) {
      if (sourceManga.mangaId == content[i].titleId) {
        const chapters: Chapter[] = [];

        for (let j = 0; j < content[i].chapters.length; j++) {
          if (content[i].chapters[j].chapterId) {
            const chapter: Chapter = {
              chapterId: content[i].chapters[j].chapterId,
              sourceManga,
              langCode: content[i].chapters[j].languageCode
                ? content[i].chapters[j].languageCode
                : "EN",
              chapNum: content[i].chapters[j].chapterNumber
                ? content[i].chapters[j].chapterNumber
                : j + 1,
              title: content[i].primaryTitle,
              volume: content[i].chapters[j].volumeNumber,
            };
            chapters.push(chapter);
          }
        }
        return chapters;
      }
    }
    throw new Error("No title with this id exists");
  }

  // Populates a chapter with images
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    for (let i = 0; i < content.length; i++) {
      if (chapter.sourceManga.mangaId == content[i].titleId) {
        for (let j = 0; j < content[i].chapters.length; j++) {
          if (chapter.chapterId == content[i].chapters[j].chapterId) {
            const chapterDetails: ChapterDetails = {
              id: chapter.chapterId,
              mangaId: chapter.sourceManga.mangaId,
              pages: content[i].chapters[j].pages,
            };
            return chapterDetails;
          }
        }
        throw new Error("No chapter with this id exists");
      }
    }
    throw new Error("No title with this id exists");
  }

  async saveCloudflareBypassCookies(cookies: Cookie[]): Promise<void> {
    // Clear all the cookies
    for (const cookie of cookies) {
        this.cookieStorageInterceptor.deleteCookie(cookie);
    }

    // Set all the cookies
    for (const cookie of cookies) {
        this.cookieStorageInterceptor.setCookie(cookie);
    }

    // Log the cookies
    console.log("\n\n This are the cookies",this.cookieStorageInterceptor.cookies);
  }

  async fetchCheerio(request: Request): Promise<CheerioAPI> {
    const [response, data] = await Application.scheduleRequest(request);
    this.checkCloudflareStatus(response.status);
    return cheerio.load(Application.arrayBufferToUTF8String(data));
  }

  checkCloudflareStatus(status: number): void {
    if (status === 503 || status === 403) {
      throw new CloudflareError({ url: DOMAIN_NAME, method: "GET" });
    }
  }
  
}

function createDiscoverSectionItem(options: {
  id: string;
  image: string;
  title: string;
  subtitle?: string;
  type: "simpleCarouselItem";
}): DiscoverSectionItem {
  return {
    type: options.type,
    mangaId: options.id,
    imageUrl: options.image,
    title: options.title,
    subtitle: options.subtitle,
    metadata: undefined,
  };
}

export const MangaDemon = new MangaDemonExtension();
