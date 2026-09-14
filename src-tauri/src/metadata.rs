use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use eyre::{OptionExt, WrapErr};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;
use tracing::instrument;
use walkdir::WalkDir;

use crate::{
    extensions::{AppHandleExt, WalkDirEntryExt},
    types::{ChapterInfo, Comic},
};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MigrateMetadataResult {
    pub comics: usize,
    pub chapters: usize,
    pub skipped: usize,
}

pub fn metadata_dir(app: &AppHandle) -> PathBuf {
    app.get_config().read().metadata_dir.clone()
}

pub fn independent_metadata_enabled(app: &AppHandle) -> bool {
    !metadata_dir(app).as_os_str().is_empty()
}

pub fn new_comic_metadata_path(app: &AppHandle, comic_path_word: &str) -> PathBuf {
    metadata_dir(app)
        .join("comics")
        .join(comic_path_word)
        .join("元数据.json")
}

pub fn new_chapter_metadata_path(app: &AppHandle, chapter_info: &ChapterInfo) -> PathBuf {
    metadata_dir(app)
        .join("comics")
        .join(&chapter_info.comic_path_word)
        .join("chapters")
        .join(format!("{}.json", chapter_info.chapter_uuid))
}

pub fn old_comic_metadata_path(comic: &Comic) -> eyre::Result<PathBuf> {
    let comic_download_dir = comic
        .comic_download_dir
        .as_ref()
        .ok_or_eyre("`comic_download_dir`字段为`None`")?;

    Ok(comic_download_dir.join("元数据.json"))
}

pub fn old_chapter_metadata_path(chapter_info: &ChapterInfo) -> eyre::Result<PathBuf> {
    let chapter_download_dir = chapter_info
        .chapter_download_dir
        .as_ref()
        .ok_or_eyre("`chapter_download_dir`字段为`None`")?;

    Ok(chapter_download_dir.join("章节元数据.json"))
}

pub fn save_comic_metadata(app: &AppHandle, comic: &Comic) -> eyre::Result<()> {
    let path = if independent_metadata_enabled(app) {
        new_comic_metadata_path(app, &comic.comic.path_word)
    } else {
        old_comic_metadata_path(comic)?
    };

    save_json(&path, comic).wrap_err(format!("写入文件`{}`失败", path.display()))
}

fn save_json<T>(path: &Path, value: &T) -> eyre::Result<()>
where
    T: Serialize,
{
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).wrap_err(format!("创建目录`{}`失败", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(value)?;
    std::fs::write(path, json)?;
    Ok(())
}

pub fn comic_metadata_paths(app: &AppHandle) -> Vec<PathBuf> {
    let mut paths_by_path_word = HashMap::<String, PathBuf>::new();

    if independent_metadata_enabled(app) {
        for path in scan_new_comic_metadata_paths(app) {
            if let Ok(path_word) = read_comic_path_word(&path) {
                paths_by_path_word.entry(path_word).or_insert(path);
            }
        }
    }

    for path in scan_old_comic_metadata_paths(app) {
        if let Ok(path_word) = read_comic_path_word(&path) {
            paths_by_path_word.entry(path_word).or_insert(path);
        }
    }

    paths_by_path_word.into_values().collect()
}

pub fn chapter_metadata_paths(
    app: &AppHandle,
    comic_download_dir: &Path,
    comic_path_word: &str,
) -> Vec<PathBuf> {
    let mut paths_by_chapter_uuid = HashMap::<String, PathBuf>::new();

    if independent_metadata_enabled(app) {
        let chapters_dir = metadata_dir(app)
            .join("comics")
            .join(comic_path_word)
            .join("chapters");
        if chapters_dir.exists() {
            for entry in WalkDir::new(chapters_dir)
                .into_iter()
                .filter_map(Result::ok)
            {
                if !entry.file_type().is_file() {
                    continue;
                }
                let path = entry.path().to_path_buf();
                if let Ok(chapter_uuid) = read_chapter_uuid(&path) {
                    paths_by_chapter_uuid.entry(chapter_uuid).or_insert(path);
                }
            }
        }
    }

    if comic_download_dir.exists() {
        for entry in WalkDir::new(comic_download_dir)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.is_chapter_metadata() {
                continue;
            }
            let path = entry.path().to_path_buf();
            if let Ok(chapter_uuid) = read_chapter_uuid(&path) {
                paths_by_chapter_uuid.entry(chapter_uuid).or_insert(path);
            }
        }
    }

    paths_by_chapter_uuid.into_values().collect()
}

#[instrument(level = "error", skip_all)]
pub fn migrate_to_metadata_dir(app: &AppHandle) -> eyre::Result<MigrateMetadataResult> {
    if !independent_metadata_enabled(app) {
        return Err(eyre::eyre!("元数据目录为空，无法迁移"));
    }

    let mut result = MigrateMetadataResult {
        comics: 0,
        chapters: 0,
        skipped: 0,
    };

    for old_comic_metadata_path in scan_old_comic_metadata_paths(app) {
        let old_comic_metadata_dir = match old_comic_metadata_path.parent() {
            Some(parent) => parent.to_path_buf(),
            None => {
                result.skipped += 1;
                continue;
            }
        };

        let comic_path_word = match read_comic_path_word(&old_comic_metadata_path) {
            Ok(path_word) => path_word,
            Err(_) => {
                result.skipped += 1;
                continue;
            }
        };

        let new_comic_metadata_path = new_comic_metadata_path(app, &comic_path_word);
        if let Some(parent) = new_comic_metadata_path.parent() {
            std::fs::create_dir_all(parent)
                .wrap_err(format!("创建目录`{}`失败", parent.display()))?;
        }
        std::fs::copy(&old_comic_metadata_path, &new_comic_metadata_path).wrap_err(format!(
            "复制`{}`到`{}`失败",
            old_comic_metadata_path.display(),
            new_comic_metadata_path.display()
        ))?;
        result.comics += 1;

        for entry in WalkDir::new(old_comic_metadata_dir)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.is_chapter_metadata() {
                continue;
            }

            let old_chapter_metadata_path = entry.path();
            let chapter_uuid = match read_chapter_uuid(old_chapter_metadata_path) {
                Ok(chapter_uuid) => chapter_uuid,
                Err(_) => {
                    result.skipped += 1;
                    continue;
                }
            };

            let new_chapter_metadata_path = metadata_dir(app)
                .join("comics")
                .join(&comic_path_word)
                .join("chapters")
                .join(format!("{chapter_uuid}.json"));
            if let Some(parent) = new_chapter_metadata_path.parent() {
                std::fs::create_dir_all(parent)
                    .wrap_err(format!("创建目录`{}`失败", parent.display()))?;
            }
            std::fs::copy(old_chapter_metadata_path, &new_chapter_metadata_path).wrap_err(
                format!(
                    "复制`{}`到`{}`失败",
                    old_chapter_metadata_path.display(),
                    new_chapter_metadata_path.display()
                ),
            )?;
            result.chapters += 1;
        }
    }

    Ok(result)
}

fn scan_new_comic_metadata_paths(app: &AppHandle) -> Vec<PathBuf> {
    let comics_dir = metadata_dir(app).join("comics");
    if !comics_dir.exists() {
        return Vec::new();
    }

    WalkDir::new(comics_dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file() && entry.file_name() == "元数据.json")
        .map(|entry| entry.path().to_path_buf())
        .collect()
}

fn scan_old_comic_metadata_paths(app: &AppHandle) -> Vec<PathBuf> {
    let download_dir = app.get_config().read().download_dir.clone();
    if !download_dir.exists() {
        return Vec::new();
    }

    WalkDir::new(download_dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(WalkDirEntryExt::is_comic_metadata)
        .map(|entry| entry.path().to_path_buf())
        .collect()
}

fn read_comic_path_word(path: &Path) -> eyre::Result<String> {
    let metadata_str =
        std::fs::read_to_string(path).wrap_err(format!("读取`{}`失败", path.display()))?;
    let comic_json: serde_json::Value = serde_json::from_str(&metadata_str)
        .wrap_err(format!("将`{}`反序列化失败", path.display()))?;
    comic_json
        .pointer("/comic/path_word")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_eyre(format!("`{}`没有`comic.path_word`字段", path.display()))
}

fn read_chapter_uuid(path: &Path) -> eyre::Result<String> {
    let metadata_str =
        std::fs::read_to_string(path).wrap_err(format!("读取`{}`失败", path.display()))?;
    let chapter_json: serde_json::Value = serde_json::from_str(&metadata_str)
        .wrap_err(format!("将`{}`反序列化失败", path.display()))?;
    chapter_json
        .get("chapterUuid")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_eyre(format!("`{}`没有`chapterUuid`字段", path.display()))
}
