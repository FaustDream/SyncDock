import { Modal, SummaryPill, Badge, EmptyState, InfoField } from "..";
import { useApp } from "../../context/AppContext";
import { UI_TEXT } from "../../constants";
import { formatDateTime, formatBytes } from "../../utils/formatters";
import { getImportStrategyLabel, getImportStrategyDescription, getLogsDirectoryStatusLabel } from "../../utils/importHelpers";
import { getRepositoryMeta, getRepositoryOwnershipLabel, getRepositoryOwnershipTone } from "../../utils/repoHelpers";
import type { ImportStrategy, RepositoryOwnership } from "../../types";

export function ImportModal() {
  const {
    importModalOpen, setImportModalOpen, closeImportModal,
    importSourcePath, importPreview, importResult, importStrategy,
    importSkipConflicts, importPathReplacements,
    setImportStrategy, setImportSkipConflicts, setImportPathReplacements,
    busyAction, handleSelectImportConfig, handleImportConfig
  } = useApp();

  const settings = useApp().settings;
  const text = UI_TEXT[settings.languageMode === "en-US" ? "en-US" : "zh-CN"];
  const canSkipImportConflicts = importStrategy === "merge" || importStrategy === "repositoriesOnly";
  const normalizedImportPathReplacements = importPathReplacements.map((item) => ({ from: item.from.trim(), to: item.to.trim() })).filter((item) => item.from && item.to);

  return (
    <Modal open={importModalOpen} title="导入配置包" onClose={closeImportModal}>
      <div className="settings-tab-content">
        <section className="inset-card">
          <div className="panel-header mini">
            <div><h4>导入文件</h4><p className="muted">先做预检查，再决定导入策略</p></div>
            <button className="ghost-button" onClick={() => void handleSelectImportConfig()} disabled={busyAction === "preview-config" || busyAction === "import-config"}>重新选择文件</button>
          </div>
          <div className="info-grid compact">
            <InfoField label="文件路径" value={importSourcePath || "-"} />
            <InfoField label="包版本" value={importPreview ? `v${importPreview.version}` : "-"} />
            <InfoField label="导出时间" value={formatDateTime(importPreview?.exportedAt)} />
          </div>
        </section>

        {importPreview ? (
          <>
            <div className="summary-row wrap">
              <SummaryPill label="仓库" value={importPreview.repositoryCount} tone="neutral" />
              <SummaryPill label="任务摘要" value={importPreview.taskCount} tone="pending" />
              <SummaryPill label="冲突项" value={importPreview.repoConflicts.length} tone={importPreview.repoConflicts.length ? "warning" : "success"} />
              <SummaryPill label="失效路径" value={importPreview.invalidRepoPaths.length} tone={importPreview.invalidRepoPaths.length ? "warning" : "success"} />
            </div>

            <section className="inset-card">
              <div className="panel-header mini"><div><h4>导入策略</h4></div></div>
              <div className="form-grid two-columns">
                <label>
                  <span>导入方式</span>
                  <select value={importStrategy} onChange={(e) => setImportStrategy(e.target.value as ImportStrategy)}>
                    <option value="merge">{getImportStrategyLabel("merge")}</option>
                    <option value="overwrite">{getImportStrategyLabel("overwrite")}</option>
                    <option value="repositoriesOnly">{getImportStrategyLabel("repositoriesOnly")}</option>
                    <option value="settingsOnly">{getImportStrategyLabel("settingsOnly")}</option>
                  </select>
                </label>
                <label className="switch-row">
                  <input type="checkbox" checked={importSkipConflicts} onChange={(e) => setImportSkipConflicts(e.target.checked)} disabled={!canSkipImportConflicts} />
                  <span>遇到路径冲突时跳过现有仓库</span>
                </label>
              </div>
            </section>

            <section className="inset-card">
              <div className="panel-header mini">
                <div><h4>路径迁移辅助</h4></div>
                <button className="ghost-button" onClick={() => setImportPathReplacements((c) => [...c, { from: "", to: "" }])}>新增规则</button>
              </div>
              <div className="stack-list compact-list">
                {importPathReplacements.map((item, index) => (
                  <div key={`replacement-${index}`} className="list-item path-replacement-row">
                    <input value={item.from} onChange={(e) => setImportPathReplacements((c) => c.map((ci, i) => i === index ? { ...ci, from: e.target.value } : ci))} placeholder="原路径前缀" />
                    <input value={item.to} onChange={(e) => setImportPathReplacements((c) => c.map((ci, i) => i === index ? { ...ci, to: e.target.value } : ci))} placeholder="新路径前缀" />
                    <button className="ghost-button" onClick={() => setImportPathReplacements((c) => c.length === 1 ? [{ from: "", to: "" }] : c.filter((_, i) => i !== index))}>移除</button>
                  </div>
                ))}
              </div>
            </section>

            {importResult ? (
              <section className="inset-card">
                <div className="panel-header mini"><div><h4>导入结果</h4></div></div>
                <div className="info-grid compact">
                  <InfoField label="应用策略" value={getImportStrategyLabel(importResult.appliedStrategy)} />
                  <InfoField label="备份目录" value={importResult.backupDirectory} />
                  <InfoField label="导入仓库数" value={String(importResult.repositoryCount)} />
                  <InfoField label="警告数" value={String(importResult.warnings.length)} />
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <EmptyState title="尚未选择配置包" description="请选择之前导出的 JSON 配置包，系统会先执行预检查。" />
        )}
      </div>
      <div className="modal-footer wrap">
        <button className="ghost-button" onClick={closeImportModal}>关闭</button>
        <button className="primary-button" onClick={() => void handleImportConfig()} disabled={!importPreview || busyAction === "preview-config" || busyAction === "import-config"}>
          {busyAction === "import-config" ? "正在导入..." : "执行导入"}
        </button>
      </div>
    </Modal>
  );
}

export function AddRepoModal() {
  const {
    addModalOpen, setAddModalOpen,
    draftRepo, setDraftRepo,
    handleAddRepository, pickFolder, busyAction,
    repositories
  } = useApp();

  const isAdding = busyAction === "add";
  const repoGroupOptions = Array.from(new Set(repositories.map((r) => r.group).filter(Boolean)));

  const handlePathChange = (newPath: string) => {
    const leafName = newPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
    setDraftRepo({ ...draftRepo, path: newPath, name: draftRepo.name || leafName });
  };

  return (
    <Modal open={addModalOpen} title="手动添加本地仓库" onClose={() => setAddModalOpen(false)}>
      <div className="form-grid add-repo-form">
        <label className="full-span">
          <span>仓库路径</span>
          <div className="path-input">
            <input value={draftRepo.path} onChange={(e) => handlePathChange(e.target.value)} placeholder="例如 D:/Code/MyProject" />
            <button type="button" className="ghost-button" onClick={() => void pickFolder((v) => handlePathChange(v))}>选择目录</button>
          </div>
        </label>
        <label><span>仓库名称</span><input value={draftRepo.name ?? ""} onChange={(e) => setDraftRepo({ ...draftRepo, name: e.target.value })} placeholder="留空则使用目录名" /></label>
        <label>
          <span>分组</span>
          <input className="group-combobox-input" list="add-repo-group-options" value={draftRepo.group ?? ""} onChange={(e) => setDraftRepo({ ...draftRepo, group: e.target.value })} placeholder="选择或输入分组" />
          <datalist id="add-repo-group-options">{repoGroupOptions.map((g) => <option key={g} value={g} />)}</datalist>
        </label>
        <label>
          <span>仓库归属</span>
          <select value={draftRepo.ownership} onChange={(e) => setDraftRepo({ ...draftRepo, ownership: e.target.value as typeof draftRepo.ownership })}>
            <option value="unassigned">未标注</option>
            <option value="mine">我的</option>
            <option value="other">其他作者</option>
          </select>
        </label>
        <label className="full-span"><span>备注</span><textarea value={draftRepo.note ?? ""} onChange={(e) => setDraftRepo({ ...draftRepo, note: e.target.value })} rows={2} /></label>
      </div>
      <div className="modal-footer add-repo-modal-footer">
        <button className="ghost-button" onClick={() => setAddModalOpen(false)}>取消</button>
        <button className="primary-button" onClick={() => void handleAddRepository()} disabled={isAdding}>
          {isAdding ? <><span className="inline-spinner"></span>正在添加...</> : "添加仓库"}
        </button>
      </div>
    </Modal>
  );
}


export function CloneRepoModal() {
  const {
    cloneModalOpen, setCloneModalOpen,
    cloneDraft, setCloneDraft,
    handleCloneRepository, pickFolder, busyAction,
    repositories
  } = useApp();

  const isCloning = busyAction === "clone";
  const repoGroupOptions = Array.from(new Set(repositories.map((r) => r.group).filter(Boolean)));

  return (
    <Modal open={cloneModalOpen} title="可视化 Clone 仓库" onClose={() => setCloneModalOpen(false)}>
      <div className="form-grid">
        <label className="full-span">
          <span>远端地址</span>
          <input value={cloneDraft.remoteUrl} onChange={(e) => setCloneDraft({ ...cloneDraft, remoteUrl: e.target.value })} placeholder="https://github.com/user/repo.git" />
        </label>
        <label className="full-span">
          <span>目标目录</span>
          <div className="path-input">
            <input value={cloneDraft.destinationParent} onChange={(e) => setCloneDraft({ ...cloneDraft, destinationParent: e.target.value })} placeholder="clone 到该目录下" />
            <button type="button" className="ghost-button" onClick={() => void pickFolder((v) => setCloneDraft({ ...cloneDraft, destinationParent: v }))}>选择目录</button>
          </div>
        </label>
        <label><span>目录名称</span><input value={cloneDraft.directoryName ?? ""} onChange={(e) => setCloneDraft({ ...cloneDraft, directoryName: e.target.value })} placeholder="留空则使用仓库名" /></label>
        <label>
          <span>分组</span>
          <input list="clone-repo-group-options" value={cloneDraft.group ?? ""} onChange={(e) => setCloneDraft({ ...cloneDraft, group: e.target.value })} placeholder="选择或输入分组" />
          <datalist id="clone-repo-group-options">{repoGroupOptions.map((g) => <option key={g} value={g} />)}</datalist>
        </label>
        <label>
          <span>仓库归属</span>
          <select value={cloneDraft.ownership} onChange={(e) => setCloneDraft({ ...cloneDraft, ownership: e.target.value as typeof cloneDraft.ownership })}>
            <option value="unassigned">未标注</option>
            <option value="mine">我的</option>
            <option value="other">其他作者</option>
          </select>
        </label>
        <label className="full-span"><span>备注</span><textarea value={cloneDraft.note ?? ""} onChange={(e) => setCloneDraft({ ...cloneDraft, note: e.target.value })} rows={2} /></label>
      </div>
      <div className="modal-footer">
        <button className="ghost-button" onClick={() => setCloneModalOpen(false)}>取消</button>
        <button className="primary-button" onClick={() => void handleCloneRepository()} disabled={isCloning}>
          {isCloning ? <><span className="inline-spinner"></span>正在 Clone...</> : "开始 Clone"}
        </button>
      </div>
    </Modal>
  );
}

