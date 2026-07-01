import { ArrowLeft, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { accountStatsFor, dockFromMyDock, myDockReviewGroup, myDockStatusLabel } from "./account-model";
import { dockFullId, type Dock, type Lang, type MyDock, type MyDocksCounts, type TEXT } from "./data";
import { DockIcon, badgeSrc } from "./display";
import { DockMetric, Pagination, StatRow } from "./desktop-ui";

export const ACCOUNT_PAGE_LIMIT = 6;

export function AccountPanel(props: {
  accountEmail: string;
  lang: Lang;
  myDocks: MyDock[];
  myDocksCounts: MyDocksCounts;
  myDocksPage: number;
  myDocksPageCount: number;
  myDocksTotal: number;
  myStarredDocks: Dock[];
  nickname: string;
  profileSaving: boolean;
  onBack: () => void;
  onOpenDetail: (dockId: string) => void;
  onSaveNickname: (nickname: string) => void;
  onSetMyDocksPage: (page: number) => void;
  t: (typeof TEXT)[Lang];
}) {
  const [draftNickname, setDraftNickname] = useState(props.nickname);
  const [accountTab, setAccountTab] = useState<"profile" | "docks" | "stars">("profile");
  const accountStats = accountStatsFor(props.myDocksCounts, props.myStarredDocks.length);
  const myDocksStart =
    props.myDocksTotal === 0 || props.myDocks.length === 0 ? 0 : (props.myDocksPage - 1) * ACCOUNT_PAGE_LIMIT + 1;
  const myDocksEnd = myDocksStart === 0 ? 0 : Math.min(props.myDocksTotal, myDocksStart + props.myDocks.length - 1);

  useEffect(() => {
    setDraftNickname(props.nickname);
  }, [props.nickname]);

  return (
    <div className="panel account-panel">
      <button className="text-button" onClick={props.onBack} type="button">
        <ArrowLeft size={15} /> {props.t.backToMain}
      </button>
      <div className="account-heading">
        <div className="kicker">{props.t.memberWorkspace}</div>
        <h1>{props.t.accountInfoTitle}</h1>
        <p>{props.t.accountInfoSub}</p>
      </div>
      <div className="account-layout">
        <aside className="profile-card" aria-label={props.t.accountProfile}>
          <div className="profile-avatar">O</div>
          <div>
            <strong>{props.nickname}</strong>
            <img alt="official badge" src={badgeSrc} />
          </div>
          <p>{props.accountEmail}</p>
          <div className="profile-stats">
            <StatRow label={props.t.submittedDocks} value={accountStats.submitted} />
            <StatRow label={props.t.approved} value={accountStats.approved} />
            <StatRow label={props.t.pending} value={accountStats.pending} />
            <StatRow label={props.t.rejected} value={accountStats.rejected} />
            <StatRow label={props.t.unavailable} value={accountStats.unavailable} />
            <StatRow label={props.t.hidden} value={accountStats.hidden} />
            <StatRow label={props.t.stars} value={accountStats.stars} />
          </div>
        </aside>
        <section className="account-main">
          <div className="account-tabs">
            <button className={accountTab === "profile" ? "active" : ""} onClick={() => setAccountTab("profile")} type="button">
              {props.t.profile}
            </button>
            <button className={accountTab === "docks" ? "active" : ""} onClick={() => setAccountTab("docks")} type="button">
              {props.t.myDocks}
            </button>
            <button className={accountTab === "stars" ? "active" : ""} onClick={() => setAccountTab("stars")} type="button">
              {props.t.stars}
            </button>
          </div>
          {accountTab === "profile" ? (
            <div className="profile-form">
              <label>
                <span>{props.t.email}</span>
                <div>{props.accountEmail}</div>
              </label>
              <label>
                <span>{props.t.nickname}</span>
                <input onChange={(event) => setDraftNickname(event.target.value)} value={draftNickname} />
              </label>
              <button disabled={props.profileSaving} onClick={() => props.onSaveNickname(draftNickname)} type="button">
                {props.profileSaving ? props.t.saving : props.t.saveChanges}
              </button>
            </div>
          ) : null}
          {accountTab === "docks" ? (
            <section className="account-list-panel">
              <div className="account-range">{myDocksStart}-{myDocksEnd} / {props.myDocksTotal}</div>
              {props.myDocks.length > 0 ? (
                <div className="starred-dock-list">
                  {props.myDocks.map((dock) => (
                    <button key={dock.id} onClick={() => props.onOpenDetail(dock.id)} type="button">
                      <DockIcon dock={dockFromMyDock(dock)} size="small" />
                      <span>
                        <strong>{dock.id}</strong>
                        <small>{dock.summary ?? dock.displayName ?? dock.name}</small>
                      </span>
                      <span className={`account-status ${myDockReviewGroup(dock)}`}>{myDockStatusLabel(myDockReviewGroup(dock), props.t)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="starred-empty">{props.t.noSubmittedDocks}</p>
              )}
              {props.myDocksTotal > 0 ? (
                <Pagination
                  label={props.t.myDocks}
                  onPageChange={props.onSetMyDocksPage}
                  page={props.myDocksPage}
                  pageCount={props.myDocksPageCount}
                  t={props.t}
                />
              ) : null}
            </section>
          ) : null}
          {accountTab === "stars" ? (
            <section className="account-list-panel">
              <div className="account-range">0-0 / {props.myStarredDocks.length}</div>
              {props.myStarredDocks.length > 0 ? (
                <div className="starred-dock-list">
                  {props.myStarredDocks.map((dock) => (
                    <button key={dockFullId(dock)} onClick={() => props.onOpenDetail(dockFullId(dock))} type="button">
                      <DockIcon dock={dock} size="small" />
                      <span>
                        <strong>{dockFullId(dock)}</strong>
                        <small>{dock.desc}</small>
                      </span>
                      <DockMetric count={dock.stars ?? 0} icon={<Star fill="currentColor" size={13} />} label={props.t.stars} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="starred-empty">{props.t.noStarredDocks}</p>
              )}
            </section>
          ) : null}
        </section>
      </div>
    </div>
  );
}
